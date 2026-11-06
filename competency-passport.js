// Isolated UI inside the existing Passport route; no credential issuance actions.
const names = ['Critical Thinking','Problem Solving','Self-Correction','Reasoning & Explanation','Independent Learning'];
const ids = ['critical','problem','correction','reasoning','independent'];
class CompetencyPassport extends (globalThis.HTMLElement || class {}) {
  connectedCallback() { this.abort = new AbortController(); this.render(); this.load(); }
  disconnectedCallback() { this.abort?.abort(); }
  async request(body) {
    const response = await fetch('/api/learning-records?view=competency', { signal:this.abort.signal, credentials:'same-origin', ...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {}) });
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || 'Dịch vụ chưa sẵn sàng');
    return data;
  }
  async load() {
    try { this.data=await this.request(); this.error=''; }
    catch(error) { if(error.name==='AbortError') return; this.error=error.message; }
    if(this.isConnected) this.render();
  }
  element(tag,text,className) { const el=document.createElement(tag); if(text!=null) el.textContent=text; if(className) el.className=className; return el; }
  render() {
    this.replaceChildren();
    const panel=this.element('section',null,'competency-panel');
    panel.append(this.element('h2','Hộ chiếu năng lực · PARADOX'),this.element('p','Điểm tiến trình không thay thế bài đánh giá chính thức. Phase 1 chưa phát hành chứng chỉ.'));
    if(this.error) { const error=this.element('p',`Chưa có dữ liệu: ${this.error}`); error.setAttribute('role','status'); panel.append(error); }
    else if(!this.data) { const loading=this.element('p','Đang tải bằng chứng…');loading.setAttribute('role','status');panel.append(loading); }
    const grid=this.element('div',null,'competency-grid');
    names.forEach((name,i)=>{
      const card=this.element('article'); const progress=this.data?.progress.scores[ids[i]], official=this.data?.official.scores[ids[i]];
      card.append(this.element('h3',name),this.element('p',`Tiến trình: ${progress==null?'Chưa đủ bằng chứng':progress+'/100'}`),this.element('strong',`Chính thức: ${official==null?'Chưa đánh giá':official+'/100'}`));
      if(official!=null) {const meter=this.element('progress');meter.max=100;meter.value=official;meter.setAttribute('aria-label',name);card.append(meter);}
      grid.append(card);
    });panel.append(grid);
    panel.append(this.element('p',`Tổng chính thức: ${this.data?.official.total ?? '—'} · ${this.data?.official.level || 'Chưa đánh giá'}`));
    const list=this.element('ul'); (this.data?.eligibility.missing || ['Cần bằng chứng được đánh giá theo rubric competency-v1; điểm AI cũ không được tự quy đổi.']).forEach(text=>list.append(this.element('li',text)));panel.append(list);
    const status=this.element('p',this.data?.eligibility.eligible ? 'Đủ điều kiện học thuật — phát hành chứng chỉ đang tắt.' : 'Chưa đủ điều kiện nhận chứng chỉ.');panel.append(status);
    if(this.data) {
      const history=this.element('details');history.append(this.element('summary','Lịch sử đánh giá'));
      this.data.history.forEach(a=>history.append(this.element('p',`${a.created_at} · ${a.status} · ${a.final_score ?? '—'}/100`)));panel.append(history);
      const active=this.data.history.find(a=>a.status==='in_progress');
      if(active) this.form(panel,active);
      else {const start=this.element('button','Bắt đầu 5 thử thách mới');start.type='button';start.disabled=!this.data.eligibility.canStart;start.onclick=()=>this.action(start,{action:'start'});panel.append(start);}
    }
    const retry=this.element('button','Tải lại bằng chứng');retry.type='button';retry.onclick=()=>this.load();panel.append(retry);
    this.append(panel);
  }
  async action(button,body) {
    button.disabled=true;
    try {await this.request(body);await this.load();}
    catch(error) {if(error.name==='AbortError')return; const message=this.element('p',error.message);message.setAttribute('role','alert');button.after(message);}
    finally {if(button.isConnected)button.disabled=false;}
  }
  form(panel,attempt) {
    const form=this.element('form');form.append(this.element('h3','Bài đánh giá độc lập'),this.element('p','Không có trợ lý AI trong bài đánh giá. Câu trả lời giải thích được người đánh giá kiểm tra trước khi có kết quả chính thức.'));
    attempt.questions.forEach(q=>{
      const field=this.element('fieldset');field.append(this.element('legend',q.prompt));
      if(q.open) {const input=this.element('textarea');input.name=q.id;input.required=true;input.maxLength=6000;input.value=attempt.answers?.[q.id]||'';input.setAttribute('aria-label',q.prompt);field.append(input);}
      else q.options.forEach((text,i)=>{const label=this.element('label');const input=this.element('input');input.type='radio';input.name=q.id;input.value=i;input.required=true;input.checked=attempt.answers?.[q.id]===i;label.append(input,document.createTextNode(text));field.append(label);});form.append(field);
    });
    const answers=()=>Object.fromEntries(attempt.questions.flatMap(q=>{const value=new FormData(form).get(q.id);return value==null?[]:[[q.id,q.open?String(value):Number(value)]];}));
    const save=this.element('button','Lưu bài');save.type='button';save.onclick=()=>this.action(save,{action:'save',attemptId:attempt.id,answers:answers()});
    const submit=this.element('button','Nộp để đánh giá');submit.type='submit';form.onsubmit=event=>{event.preventDefault();this.action(submit,{action:'submit',attemptId:attempt.id,answers:answers()});};
    form.append(save,submit);panel.append(form);
  }
}
if(globalThis.customElements && !customElements.get('competency-passport')) customElements.define('competency-passport',CompetencyPassport);
