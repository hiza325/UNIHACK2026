/* ZK Proof of Learning view. Minimal read-only shell until the full UX is wired. */
export const zkViews = {
  viewZk() {
    const t = key => this.t(key);
    const head = this.viewHead(t('pageZk') || 'ZK Proof of Learning', 'zkSub');
    const status = this.zkStatus ? `<pre class="zk-state">${this.escape(JSON.stringify(this.zkStatus))}</pre>` : '<p class="zk-state">Status not checked yet.</p>';
    const proofResult = this.zkVerifyResult ? `<pre class="zk-state">${this.escape(JSON.stringify(this.zkVerifyResult))}</pre>` : '';
    const generateResult = this.zkGenerateResult ? `<pre class="zk-state">${this.escape(JSON.stringify(this.zkGenerateResult))}</pre>` : '';
    return `<div class="page zk-page" data-zk-state="ready">
      ${head}
      <section class="card zk-card">
        <div class="panel-head"><div><h2 class="panel-title">ZK status</h2><p class="panel-sub">Read-only verification configuration.</p></div></div>
        <button class="ghost-button" type="button" data-zk-status>${t('dataRetry')} ↗</button>
        ${status}
      </section>
      <section class="card zk-card">
        <div class="panel-head"><div><h2 class="panel-title">Verify proof</h2><p class="panel-sub">Paste a proofId. No witness, score or nonce is displayed.</p></div></div>
        <form id="zk-verify-form" class="zk-form">
          <input id="zk-proof-id" type="text" placeholder="proofId" required />
          <button class="ghost-button" type="submit">Verify</button>
        </form>
        ${proofResult}
      </section>
      <section class="card zk-card">
        <div class="panel-head"><div><h2 class="panel-title">Generate proof</h2><p class="panel-sub">Requires an eligible server-owned evaluation.</p></div></div>
        <form id="zk-generate-form" class="zk-form">
          <input id="zk-evaluation-id" type="text" placeholder="evaluationId" required />
          <button class="ghost-button" type="submit">Generate</button>
        </form>
        ${generateResult}
      </section>
    </div>`;
  },
};
