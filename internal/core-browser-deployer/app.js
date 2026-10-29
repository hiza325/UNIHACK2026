import { BrowserProvider, ContractFactory, Interface, formatEther, formatUnits, getAddress, keccak256 } from '/vendor/ethers.min.js';
import { FUJI_CHAIN_HEX, FUJI_CHAIN_ID, createFujiGuardedProvider, inspectCoreSigningNetwork, normalizeChainId } from '/provider-guard.js';
import { AVALANCHE_FUJI_CONFIG, avalancheFujiAddressUrl, avalancheFujiTransactionUrl } from '/avalanche-config.js';

const CONFIRMATION_TEXT = 'DEPLOY TO FUJI';
const REQUIRED_FUNCTIONS = ['owner()', 'authorizedIssuers(address)'];

const state = {
  artifact: null,
  artifactChecks: null,
  coreProvider: null,
  connectedCoreProvider: null,
  guardedProvider: null,
  browserProvider: null,
  signer: null,
  address: null,
  chainId: null,
  providerSource: null,
  providerSessionId: null,
  fujiSwitchConfirmed: false,
  coreSigningNetwork: null,
  diagnostics: [],
  preflight: null,
  manifestUrl: null,
  boundProvider: null,
};

const $ = id => document.getElementById(id);
const elements = {
  connect: $('connect-wallet'), switchFuji: $('switch-fuji'), coreDetection: $('core-detection'), address: $('wallet-address'), chainId: $('chain-id'),
  providerSession: $('provider-session'), coreSigningNetwork: $('core-signing-network'), networkDiagnostics: $('network-diagnostics'),
  artifactStatus: $('artifact-status'), contractName: $('contract-name'), constructorArguments: $('constructor-arguments'),
  expectedOwner: $('expected-owner'), expectedIssuer: $('expected-issuer'), runtimeHash: $('runtime-hash'),
  preflightButton: $('run-preflight'), preflightStatus: $('preflight-status'), preflightOutput: $('preflight-output'),
  confirmCheckbox: $('confirm-checkbox'), confirmText: $('confirm-text'), deployButton: $('deploy-contract'),
  deploymentResult: $('deployment-result'), downloadManifest: $('download-manifest'), status: $('status-message'),
};

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function setPill(element, text, type = 'neutral') {
  element.textContent = text;
  element.className = `pill ${type}`;
}

function serializableNetwork(network) {
  if (!network) return null;
  return {
    verified: Boolean(network.verified),
    reason: network.reason || null,
    ethChainId: network.ethChainId === null ? null : String(network.ethChainId),
    ethChainIdHex: network.ethChainIdHex ?? null,
    coreChainId: network.coreChainId === null ? null : String(network.coreChainId),
    coreChainIdHex: network.coreChainIdHex ?? null,
    coreChainName: network.coreChainName ?? null,
    isTestnet: network.isTestnet ?? null,
    methodErrorCode: network.methodErrorCode ?? null,
  };
}

function addNetworkDiagnostic(event, network) {
  state.diagnostics.push({ time: new Date().toISOString(), event, ...serializableNetwork(network) });
  state.diagnostics = state.diagnostics.slice(-12);
  elements.networkDiagnostics.textContent = JSON.stringify(state.diagnostics, null, 2);
}

async function requireVerifiedCoreFuji(provider, event) {
  const network = await inspectCoreSigningNetwork(provider);
  state.coreSigningNetwork = network;
  addNetworkDiagnostic(event, network);
  updateWalletView();
  if (!network.verified) {
    throw new Error(`${network.reason}; eth_chainId=${network.ethChainId}, Core chainId=${network.coreChainId}, isTestnet=${network.isTestnet}; required Fuji chainId=43113, isTestnet=true`);
  }
  return network;
}

function markCheck(name, result) {
  const item = document.querySelector(`[data-check="${name}"]`);
  if (item) item.className = result === true ? 'pass' : result === false ? 'fail' : '';
}

function resetPreflight(message = 'Chưa chạy') {
  state.preflight = null;
  setPill(elements.preflightStatus, message, 'neutral');
  for (const item of document.querySelectorAll('[data-check]')) item.className = '';
  elements.preflightOutput.hidden = true;
  elements.preflightOutput.textContent = '';
  elements.confirmCheckbox.checked = false;
  elements.confirmCheckbox.disabled = true;
  elements.confirmText.value = '';
  elements.confirmText.disabled = true;
  elements.deployButton.disabled = true;
}

function updateDeployGate() {
  elements.deployButton.disabled = !state.preflight
    || !elements.confirmCheckbox.checked
    || elements.confirmText.value.trim() !== CONFIRMATION_TEXT;
}

function updateWalletView() {
  elements.address.textContent = state.address || 'Chưa kết nối';
  elements.chainId.textContent = state.chainId === null ? '—' : String(state.chainId);
  elements.expectedOwner.textContent = state.address || 'Chờ kết nối ví';
  elements.expectedIssuer.textContent = state.address ? `${state.address} · authorized = true` : 'Chờ kết nối ví';
  const sameProvider = Boolean(state.connectedCoreProvider && state.connectedCoreProvider === state.coreProvider
    && state.signer?.provider === state.browserProvider);
  elements.providerSession.textContent = sameProvider
    ? `PASS · ${state.providerSource} · ${state.providerSessionId}`
    : 'Chưa xác nhận cùng provider';
  const signingNetwork = state.coreSigningNetwork;
  elements.coreSigningNetwork.textContent = signingNetwork?.verified
    ? `PASS · ${signingNetwork.coreChainName || 'Core'} · ${signingNetwork.coreChainId} · testnet=${signingNetwork.isTestnet}`
    : signingNetwork ? `BLOCKED · ${signingNetwork.reason}` : 'Chưa xác minh';
  const ready = Boolean(state.address && state.signer && state.browserProvider && sameProvider
    && state.fujiSwitchConfirmed && state.chainId === FUJI_CHAIN_ID && state.artifactChecks?.valid);
  elements.preflightButton.disabled = !ready;
}

function validateArtifact(artifact) {
  if (artifact.contractName !== 'LearningCredentialRegistry') throw new Error('Artifact không phải LearningCredentialRegistry');
  if (!Array.isArray(artifact.abi)) throw new Error('Artifact thiếu ABI');
  if (!/^0x[0-9a-fA-F]+$/.test(artifact.bytecode || '') || artifact.bytecode === '0x') throw new Error('Artifact thiếu deployment bytecode');
  if (!/^0x[0-9a-fA-F]+$/.test(artifact.deployedBytecode || '') || artifact.deployedBytecode === '0x') throw new Error('Artifact thiếu runtime bytecode');

  const constructorInputs = artifact.abi.find(item => item.type === 'constructor')?.inputs || [];
  if (constructorInputs.length !== 0) throw new Error(`Constructor yêu cầu ${constructorInputs.length} tham số; dự kiến là 0`);
  const contractInterface = new Interface(artifact.abi);
  for (const signature of REQUIRED_FUNCTIONS) {
    if (!contractInterface.getFunction(signature)) throw new Error(`ABI thiếu ${signature}`);
  }
  return {
    valid: true,
    constructorInputs,
    deploymentBytecodeHash: keccak256(artifact.bytecode),
    runtimeBytecodeHash: keccak256(artifact.deployedBytecode),
  };
}

async function loadArtifact() {
  const response = await fetch('/artifact.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Không tải được Hardhat artifact (${response.status})`);
  state.artifact = await response.json();
  state.artifactChecks = validateArtifact(state.artifact);
  elements.contractName.textContent = state.artifact.contractName;
  elements.constructorArguments.textContent = '[] · không có tham số';
  elements.runtimeHash.textContent = state.artifactChecks.runtimeBytecodeHash;
  setPill(elements.artifactStatus, 'ARTIFACT PASS', 'pass');
  updateWalletView();
  setStatus('Artifact hợp lệ. Hãy kết nối Core Wallet để tiếp tục.', 'success');
}

function selectCoreProvider(provider, source = 'Core') {
  if (!provider?.request || state.coreProvider) return;
  state.coreProvider = provider;
  state.providerSource = source;
  elements.switchFuji.disabled = false;
  setPill(elements.coreDetection, `${source} detected`, 'pass');
}

function resetConnectedProvider() {
  state.connectedCoreProvider = null;
  state.guardedProvider = null;
  state.browserProvider = null;
  state.signer = null;
  state.address = null;
  state.providerSessionId = null;
}

function discoverCore() {
  window.addEventListener('eip6963:announceProvider', event => {
    const { info, provider } = event.detail || {};
    if (info?.rdns === 'app.core' || (provider?.isAvalanche === true && /core/i.test(info?.name || ''))) {
      selectCoreProvider(provider, 'Core EIP-6963');
    }
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  if (window.avalanche?.request) selectCoreProvider(window.avalanche, 'Core window.avalanche');
  setTimeout(() => {
    if (!state.coreProvider && window.avalanche?.request) selectCoreProvider(window.avalanche, 'Core window.avalanche');
    if (!state.coreProvider) setPill(elements.coreDetection, 'Không tìm thấy Core', 'fail');
  }, 500);
}

function bindProviderEvents(provider) {
  if (state.boundProvider === provider || typeof provider.on !== 'function') return;
  state.boundProvider = provider;
  provider.on('accountsChanged', accounts => {
    const hasAccount = Boolean(accounts?.[0]);
    resetConnectedProvider();
    resetPreflight('Tài khoản đã thay đổi');
    updateWalletView();
    setStatus(hasAccount ? 'Tài khoản Core đã thay đổi. Hãy kết nối lại trước khi chạy preflight.' : 'Core Wallet đã ngắt kết nối.', 'error');
  });
  provider.on('chainChanged', chainId => {
    state.chainId = normalizeChainId(chainId);
    state.fujiSwitchConfirmed = false;
    state.coreSigningNetwork = null;
    resetConnectedProvider();
    resetPreflight('Mạng đã thay đổi');
    updateWalletView();
    setStatus(state.chainId === FUJI_CHAIN_ID ? 'Đã chuyển sang Fuji. Hãy kết nối lại trước khi chạy preflight.' : 'Sai mạng: chỉ chấp nhận Avalanche Fuji Chain ID 43113.', state.chainId === FUJI_CHAIN_ID ? 'success' : 'error');
  });
}

async function switchCoreToFuji() {
  elements.switchFuji.disabled = true;
  try {
    const core = state.coreProvider || window.avalanche;
    if (!core?.request) throw new Error('Không tìm thấy Core Extension');
    await core.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: FUJI_CHAIN_HEX }] });
    const chainId = normalizeChainId(await core.request({ method: 'eth_chainId' }));
    if (chainId !== FUJI_CHAIN_ID) throw new Error(`Core vẫn báo Chain ID ${chainId}; yêu cầu Fuji 43113`);
    await requireVerifiedCoreFuji(core, 'after-wallet_switchEthereumChain');
    state.chainId = chainId;
    state.fujiSwitchConfirmed = true;
    resetConnectedProvider();
    resetPreflight('Chờ kết nối lại');
    updateWalletView();
    setStatus('Core đã xác nhận wallet_switchEthereumChain tới Fuji 43113. Hãy Connect Core Wallet.', 'success');
  } catch (error) {
    state.fujiSwitchConfirmed = false;
    const message = error.code === 4001
      ? 'Bạn đã từ chối chuyển Core sang Fuji.'
      : error.code === 4902
        ? 'Core chưa bật mạng Fuji tích hợp. Hãy bật Testnet Mode; không cần thêm custom network trùng lặp.'
        : (error.shortMessage || error.message);
    setStatus(message, 'error');
  } finally {
    elements.switchFuji.disabled = !state.coreProvider;
  }
}

async function connectWallet() {
  try {
    const core = state.coreProvider || window.avalanche;
    if (!core?.request) throw new Error('Không tìm thấy Core Extension. Hãy mở/khởi động lại Core rồi tải lại trang.');
    selectCoreProvider(core, 'Core window.avalanche');
    const accounts = await core.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('Core không trả về tài khoản nào');
    const chainId = normalizeChainId(await core.request({ method: 'eth_chainId' }));
    state.address = getAddress(accounts[0]);
    state.chainId = chainId;
    await requireVerifiedCoreFuji(core, 'connect');
    state.connectedCoreProvider = core;
    state.guardedProvider = createFujiGuardedProvider(core, {
      getExpectedAddress: () => state.address,
      onDiagnostic: addNetworkDiagnostic,
    });
    state.browserProvider = new BrowserProvider(state.guardedProvider, 'any');
    state.signer = await state.browserProvider.getSigner(state.address);
    state.providerSessionId = globalThis.crypto?.randomUUID?.().slice(0, 8) || Date.now().toString(36);
    bindProviderEvents(core);
    resetPreflight();
    updateWalletView();
    if (chainId !== FUJI_CHAIN_ID) {
      setStatus(`Core đang ở Chain ID ${chainId ?? 'không xác định'}. Hãy chuyển sang Avalanche Fuji 43113 trong Core.`, 'error');
      return;
    }
    if (!state.fujiSwitchConfirmed) {
      setStatus('Chain ID đang là 43113 nhưng chưa có network attestation. Hãy bấm “Đồng bộ Core sang Fuji”, rồi kết nối lại.', 'error');
      return;
    }
    setStatus('Core đã kết nối trên Avalanche Fuji. Chưa có giao dịch nào được ký hoặc gửi.', 'success');
  } catch (error) {
    setStatus(error.code === 4001 ? 'Bạn đã từ chối kết nối Core Wallet.' : error.message, 'error');
  }
}

async function currentWalletState() {
  if (!state.connectedCoreProvider || state.connectedCoreProvider !== state.coreProvider) throw new Error('Core provider session đã thay đổi');
  const chainId = normalizeChainId(await state.connectedCoreProvider.request({ method: 'eth_chainId' }));
  const accounts = await state.connectedCoreProvider.request({ method: 'eth_accounts' });
  const address = accounts?.[0] ? getAddress(accounts[0]) : null;
  return { chainId, address };
}

async function feeQuote(coreProvider) {
  const gasPrice = BigInt(await coreProvider.request({ method: 'eth_gasPrice' }));
  let baseFeePerGas = null;
  let maxPriorityFeePerGas = null;
  try {
    const latestBlock = await coreProvider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
    if (latestBlock?.baseFeePerGas) baseFeePerGas = BigInt(latestBlock.baseFeePerGas);
  } catch { /* Fall back to legacy gasPrice. */ }
  try {
    maxPriorityFeePerGas = BigInt(await coreProvider.request({ method: 'eth_maxPriorityFeePerGas' }));
  } catch { /* Fall back to legacy gasPrice. */ }

  if (baseFeePerGas !== null && maxPriorityFeePerGas !== null) {
    return {
      type: 2,
      gasPrice,
      baseFeePerGas,
      maxPriorityFeePerGas,
      maxFeePerGas: baseFeePerGas * 2n + maxPriorityFeePerGas,
    };
  }
  return { type: 0, gasPrice, baseFeePerGas: null, maxPriorityFeePerGas: null, maxFeePerGas: gasPrice };
}

async function runPreflight() {
  resetPreflight('Đang chạy…');
  elements.preflightButton.disabled = true;
  try {
    if (!state.coreProvider?.request) throw new Error('Core EIP-1193 chưa kết nối');
    if (!state.fujiSwitchConfirmed) throw new Error('Chưa xác nhận wallet_switchEthereumChain tới Fuji');
    if (state.connectedCoreProvider !== state.coreProvider || state.signer?.provider !== state.browserProvider) {
      throw new Error('Preflight refused: signer và Core provider không cùng session');
    }
    markCheck('core', true);
    const live = await currentWalletState();
    const signingNetwork = await requireVerifiedCoreFuji(state.connectedCoreProvider, 'preflight');
    if (live.chainId !== FUJI_CHAIN_ID) {
      markCheck('chain', false);
      throw new Error(`Sai Chain ID ${live.chainId}; yêu cầu Fuji 43113`);
    }
    markCheck('chain', true);
    if (!live.address || live.address !== state.address) {
      markCheck('account', false);
      throw new Error('Tài khoản Core đã thay đổi; hãy kết nối lại');
    }
    markCheck('account', true);

    state.artifactChecks = validateArtifact(state.artifact);
    markCheck('artifact', true);
    markCheck('permissions', true);

    const balance = await state.browserProvider.getBalance(state.address);
    const factory = new ContractFactory(state.artifact.abi, state.artifact.bytecode, state.signer);
    const deployRequest = await factory.getDeployTransaction();
    const estimatedGas = await state.browserProvider.estimateGas({ ...deployRequest, from: state.address });
    const bufferedGasLimit = estimatedGas * 120n / 100n;
    const fees = await feeQuote(state.connectedCoreProvider);
    if (fees.maxFeePerGas <= 0n) throw new Error('Core/Fuji không trả về fee data hợp lệ');
    const estimatedMaximumCost = bufferedGasLimit * fees.maxFeePerGas;
    if (balance < estimatedMaximumCost) throw new Error('Ví không đủ Fuji AVAX cho gas estimate có buffer');
    markCheck('gas', true);

    state.preflight = {
      address: state.address,
      chainId: Number(live.chainId),
      coreSigningNetwork: serializableNetwork(signingNetwork),
      constructorArguments: [],
      expectedOwner: state.address,
      expectedIssuer: state.address,
      ownerAuthorizedExpected: true,
      balanceAvax: formatEther(balance),
      estimatedGas: estimatedGas.toString(),
      bufferedGasLimit: bufferedGasLimit.toString(),
      feeType: fees.type,
      gasPriceGwei: formatUnits(fees.gasPrice, 'gwei'),
      baseFeePerGasGwei: fees.baseFeePerGas === null ? null : formatUnits(fees.baseFeePerGas, 'gwei'),
      maxFeePerGasGwei: formatUnits(fees.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGasGwei: fees.maxPriorityFeePerGas === null ? null : formatUnits(fees.maxPriorityFeePerGas, 'gwei'),
      estimatedMaximumCostAvax: formatEther(estimatedMaximumCost),
      deploymentBytecodeHash: state.artifactChecks.deploymentBytecodeHash,
      runtimeBytecodeHash: state.artifactChecks.runtimeBytecodeHash,
      transactionSigned: false,
      transactionSent: false,
    };
    elements.preflightOutput.textContent = JSON.stringify({ status: 'PREFLIGHT_READY', ...state.preflight }, null, 2);
    elements.preflightOutput.hidden = false;
    elements.confirmCheckbox.disabled = false;
    elements.confirmText.disabled = false;
    setPill(elements.preflightStatus, 'PREFLIGHT PASS', 'pass');
    setStatus('Preflight PASS. Chưa ký và chưa gửi giao dịch.', 'success');
  } catch (error) {
    setPill(elements.preflightStatus, 'PREFLIGHT FAIL', 'fail');
    elements.preflightOutput.textContent = JSON.stringify({ status: 'PREFLIGHT_FAIL', message: error.shortMessage || error.message }, null, 2);
    elements.preflightOutput.hidden = false;
    setStatus(error.shortMessage || error.message, 'error');
  } finally {
    updateWalletView();
    updateDeployGate();
  }
}

async function assertDeploymentState() {
  if (!state.fujiSwitchConfirmed) throw new Error('Deployment refused: Fuji network attestation is missing');
  if (state.connectedCoreProvider !== state.coreProvider || state.signer?.provider !== state.browserProvider) {
    throw new Error('Deployment refused: signer và preflight không dùng cùng Core provider');
  }
  const live = await currentWalletState();
  await requireVerifiedCoreFuji(state.connectedCoreProvider, 'before-deployment-state-check');
  if (live.chainId !== FUJI_CHAIN_ID) throw new Error('Deployment refused: Core không ở Fuji 43113');
  if (!live.address || live.address !== state.preflight?.address) throw new Error('Deployment refused: tài khoản Core đã thay đổi');
  const liveArtifactChecks = validateArtifact(state.artifact);
  if (liveArtifactChecks.deploymentBytecodeHash !== state.preflight.deploymentBytecodeHash
    || liveArtifactChecks.runtimeBytecodeHash !== state.preflight.runtimeBytecodeHash) {
    throw new Error('Deployment refused: artifact đã thay đổi sau preflight');
  }
  state.artifactChecks = liveArtifactChecks;
}

function exposeManifest(manifest) {
  if (state.manifestUrl) URL.revokeObjectURL(state.manifestUrl);
  state.manifestUrl = URL.createObjectURL(new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' }));
  elements.downloadManifest.href = state.manifestUrl;
  elements.downloadManifest.download = 'avalanche-fuji.json';
  elements.downloadManifest.hidden = false;
}

async function deployContract() {
  if (!state.preflight || !elements.confirmCheckbox.checked || elements.confirmText.value.trim() !== CONFIRMATION_TEXT) return;
  elements.deployButton.disabled = true;
  elements.deploymentResult.textContent = 'Đang kiểm tra lại trạng thái trước khi mở Core…';
  try {
    await assertDeploymentState();
    const factory = new ContractFactory(state.artifact.abi, state.artifact.bytecode, state.signer);
    const deployRequest = await factory.getDeployTransaction();
    const estimatedGas = await state.browserProvider.estimateGas({ ...deployRequest, from: state.address });
    const gasLimit = estimatedGas * 120n / 100n;
    const fees = await feeQuote(state.connectedCoreProvider);
    const balance = await state.browserProvider.getBalance(state.address);
    const maximumCost = gasLimit * fees.maxFeePerGas;
    if (balance < maximumCost) {
      throw new Error(`Deployment refused: Fuji balance ${formatEther(balance)} AVAX is below estimated maximum fee ${formatEther(maximumCost)} AVAX`);
    }
    await assertDeploymentState();
    const overrides = fees.type === 2
      ? { chainId: FUJI_CHAIN_ID, type: 2, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
      : { chainId: FUJI_CHAIN_ID, type: 0, gasLimit, gasPrice: fees.gasPrice };
    elements.deploymentResult.textContent = `Fuji 43113 · balance ${formatEther(balance)} AVAX · gasLimit ${gasLimit} · maxFee ${formatUnits(fees.maxFeePerGas, 'gwei')} gwei. Đang mở Core…`;
    const contract = await factory.deploy(overrides);
    const transaction = contract.deploymentTransaction();
    elements.deploymentResult.textContent = `Đã gửi: ${transaction.hash}. Đang chờ 1 confirmation…`;
    const receipt = await transaction.wait(1);
    if (!receipt || Number(receipt.status) !== 1) throw new Error('Deployment transaction đã mined nhưng thất bại');

    const address = getAddress(await contract.getAddress());
    const runtimeBytecode = await state.browserProvider.getCode(address);
    if (runtimeBytecode === '0x') throw new Error('Không tìm thấy runtime bytecode sau deployment');
    const runtimeBytecodeHash = keccak256(runtimeBytecode);
    if (runtimeBytecodeHash !== state.artifactChecks.runtimeBytecodeHash) throw new Error('Runtime bytecode không khớp Hardhat artifact');
    const owner = getAddress(await contract.owner());
    const ownerAuthorized = Boolean(await contract.authorizedIssuers(owner));
    if (owner !== state.address || !ownerAuthorized) throw new Error('Owner/issuer verification thất bại');

    const manifest = {
      contract: AVALANCHE_FUJI_CONFIG.contractName,
      network: AVALANCHE_FUJI_CONFIG.network,
      chainId: Number(FUJI_CHAIN_ID),
      address,
      deploymentTransactionHash: transaction.hash,
      deployer: state.address,
      owner,
      blockNumber: Number(receipt.blockNumber),
      receiptStatus: Number(receipt.status),
      runtimeBytecodeHash,
      artifactRuntimeBytecodeHash: state.artifactChecks.runtimeBytecodeHash,
      runtimeBytecodeMatchesArtifact: true,
      explorerAddressUrl: avalancheFujiAddressUrl(address),
      explorerTransactionUrl: avalancheFujiTransactionUrl(transaction.hash),
      deployedAt: new Date().toISOString(),
      signer: 'core-eip-1193',
    };
    exposeManifest(manifest);
    elements.deploymentResult.textContent = JSON.stringify(manifest, null, 2);
    setStatus('Deployment và post-deployment verification PASS. Hãy tải manifest.', 'success');
  } catch (error) {
    const message = error.code === 4001 ? 'Bạn đã từ chối giao dịch trong Core.' : (error.shortMessage || error.message);
    elements.deploymentResult.textContent = message;
    setStatus(message, 'error');
  } finally {
    updateDeployGate();
  }
}

elements.connect.addEventListener('click', connectWallet);
elements.switchFuji.addEventListener('click', switchCoreToFuji);
elements.preflightButton.addEventListener('click', runPreflight);
elements.confirmCheckbox.addEventListener('change', updateDeployGate);
elements.confirmText.addEventListener('input', updateDeployGate);
elements.deployButton.addEventListener('click', deployContract);

discoverCore();
loadArtifact().catch(error => {
  setPill(elements.artifactStatus, 'ARTIFACT FAIL', 'fail');
  setStatus(error.message, 'error');
});
