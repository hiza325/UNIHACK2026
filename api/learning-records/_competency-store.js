import { learningRecordStoreConfig } from './_store.js';
export function createCompetencyStore({env=process.env,fetcher=globalThis.fetch}={}) {
  const {url,serviceKey} = learningRecordStoreConfig(env);
  async function request(table, query = {}, method = 'GET', body) {
    const response = await fetcher(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`, { method, headers:{ apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, 'Content-Type':'application/json', Prefer:'return=representation' }, ...(body ? {body:JSON.stringify(body)} : {}) });
    if (!response.ok) throw Object.assign(new Error(response.status===409?'Dữ liệu đã được ghi bởi request khác':'Kho dữ liệu năng lực chưa sẵn sàng'), {status:response.status===409?409:503});
    return response.json();
  }
  async function list(table,learner,order) {
    const rows=[];
    for(let offset=0;;offset+=200) {
      const page=await request(table,{learner_id:`eq.${learner}`,order,limit:'200',offset:String(offset)});
      rows.push(...page);
      if(page.length<200) return rows;
    }
  }
  return {
    evidence: learner => list('competency_evidence',learner,'created_at.asc,id.asc'),
    attempts: learner => list('competency_attempts',learner,'created_at.desc,id.desc'),
    insert: row => request('competency_attempts',{},'POST',row).then(rows=>rows[0]),
    insertEvidence: row => request('competency_evidence',{},'POST',row).then(rows=>rows[0]),
    findAttempt: id => request('competency_attempts',{id:`eq.${id}`}).then(rows=>rows[0]),
    findSource: (id,learner) => request('learning_submissions',{id:`eq.${id}`,learner_id:`eq.${learner}`}).then(rows=>rows[0]),
    update: (id,learner,status,patch) => request('competency_attempts',{id:`eq.${id}`,learner_id:`eq.${learner}`,status:`eq.${status}`},'PATCH',patch).then(rows=>rows[0]),
  };
}
