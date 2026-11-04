/* ZK Proof of Learning view. Read-only status, eligibility, generation and verification. */
export const zkViews = {
  zkDemoBadge() {
    return '<span class="credential-status pending">DEMO</span>';
  },
  viewZk() {
    const t = key => this.t(key);
    const head = this.viewHead(t('pageZk') || 'ZK Proof of Learning', 'zkSub');
    const status = this.zkStatus
      ? `<pre class="zk-state">${this.escape(JSON.stringify(this.zkStatus))}</pre>`
      : '<p class="zk-state">Status not checked yet.</p>';
    const eligibility = (this.zkEligibleEvaluations || []).map(item => `
      <article class="passport-eligible-row">
        <div><strong>${this.escape(item.id)}</strong><small>score ${this.escape(item.score)} · ${this.escape(item.status)} · ${this.escape(item.rubricVersion || '')}</small></div>
        <button class="ghost-button" type="button" data-zk-generate="${this.escape(item.id)}">Generate ${this.zkDemoBadge()}</button>
      </article>`).join('') || '<p class="passport-empty-list">No eligible evaluations.</p>';
    const proofs = (this.zkProofs || []).map(item => `
      <article class="credential-row">
        <div class="credential-main"><span class="credential-code">${this.escape(item.proofId)}</span><h3>${this.escape(item.circuit?.name || 'score_threshold')} · threshold ${this.escape(item.threshold)}</h3><p>${this.escape(item.issuedAt)} · ${this.escape(item.status)}</p></div>
        ${item.classification === 'DEMO' ? this.zkDemoBadge() : `<span class="credential-status ${item.classification === 'OFFICIAL' ? 'verified' : 'pending'}">${this.escape(item.classification || 'UNCLASSIFIED')}</span>`}
        <button class="row-action" type="button" data-zk-verify="${this.escape(item.proofId)}">Verify ↗</button>
      </article>`).join('') || '<p class="passport-empty-list">No proofs yet.</p>';
    const proofResult = this.zkVerifyResult
      ? `<pre class="zk-state">${this.escape(JSON.stringify({ valid: this.zkVerifyResult.valid, reason: this.zkVerifyResult.reason, classification: this.zkVerifyResult.classification, credentialStatus: this.zkVerifyResult.credentialStatus }))}</pre>`
      : '';
    const generateResult = this.zkGenerateResult
      ? `<pre class="zk-state">${this.escape(JSON.stringify({ status: this.zkGenerateResult.status, proofId: this.zkGenerateResult.proofId, classification: this.zkGenerateResult.classification, code: this.zkGenerateResult.code }))}</pre>`
      : '';
    const errors = [this.zkProofsError, this.zkEligibilityError].filter(Boolean).map(message => `<p class="zk-state error" role="alert">${this.escape(message)}</p>`).join('');
    return `<div class="page zk-page" data-zk-state="ready">
      ${head}
      ${errors}
      <section class="card zk-card">
        <div class="panel-head"><div><h2 class="panel-title">ZK status ${this.zkDemoBadge()}</h2><p class="panel-sub">Read-only verification configuration. Development artifacts are DEMO only.</p></div></div>
        <button class="ghost-button" type="button" data-zk-status>${t('dataRetry')} ↗</button>
        ${status}
      </section>
      <section class="card zk-card">
        <div class="panel-head"><div><h2 class="panel-title">Eligible evaluations</h2><p class="panel-sub">Server-owned evaluations with score ≥ 80 and a valid credential binding.</p></div></div>
        <div class="passport-eligible-list">${eligibility}</div>
      </section>
      <section class="card zk-card">
        <div class="panel-head"><div><h2 class="panel-title">My proofs</h2><p class="panel-sub">Public proof metadata only. No witness, score or nonce is shown.</p></div></div>
        <div class="credential-list">${proofs}</div>
      </section>
      <section class="card zk-card">
        <div class="panel-head"><div><h2 class="panel-title">Verify proof</h2><p class="panel-sub">Paste a proofId or use a proof above.</p></div></div>
        <form id="zk-verify-form" class="zk-form">
          <input id="zk-proof-id" type="text" placeholder="proofId" required />
          <button class="ghost-button" type="submit">Verify</button>
        </form>
        ${proofResult}
      </section>
      <section class="card zk-card">
        <div class="panel-head"><div><h2 class="panel-title">Generate proof</h2><p class="panel-sub">Requires an eligible server-owned evaluation and server-side signing.</p></div></div>
        <form id="zk-generate-form" class="zk-form">
          <input id="zk-evaluation-id" type="text" placeholder="evaluationId" required />
          <button class="ghost-button" type="submit">Generate ${this.zkDemoBadge()}</button>
        </form>
        ${generateResult}
      </section>
    </div>`;
  },
};
