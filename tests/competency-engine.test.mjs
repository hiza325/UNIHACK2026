import {test} from 'node:test';
import assert from 'node:assert/strict';
import {aggregate,eligibility,level,SKILLS,validateRatings} from '../api/learning-records/_competency-engine.js';
import {createCompetencyService,reviewAssessment} from '../api/learning-records/_competency-service.js';
import {createLearningRecordsHandler} from '../api/learning-records/index.js';
import {createCompetencyStore} from '../api/learning-records/_competency-store.js';
const ratings=score=>Object.fromEntries(SKILLS.map(s=>[s.id,{score,reason:'Bằng chứng cụ thể đã được kiểm tra.'}]));
test('PostgREST learner reads and conditional writes carry ownership filters',async()=>{
  const requests=[];
  const store=createCompetencyStore({env:{SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'unit-test-only'},fetcher:async(url,options)=>{requests.push({url:new URL(url),options});return {ok:true,json:async()=>[]};}});
  await store.evidence('A');await store.attempts('A');await store.findSource('submission-B','A');await store.update('attempt-B','A','in_progress',{answers:{}});
  assert.ok(requests.every(r=>r.url.searchParams.get('learner_id')==='eq.A'));
  assert.equal(requests.at(-1).url.searchParams.get('status'),'eq.in_progress');
});
const evidence=Array.from({length:10},(_,i)=>({challenge_id:`c${i}`,session_id:`s${i%3}`,situation:['scenario','decision','evidence'][i%3],valid:true,rubric_version:'competency-v1',ratings:ratings(100),independent:true}));
function fixture() {
  const rows=[];
  const store={evidence:async()=>evidence,attempts:async learner=>rows.filter(a=>a.learner_id===learner).slice().reverse(),insert:async row=>{rows.push(row);return row;},update:async(id,learner,status,patch)=>{const row=rows.find(a=>a.id===id&&a.learner_id===learner&&a.status===status);if(row)Object.assign(row,patch);return row;}};
  return {store,rows,service:createCompetencyService(store)};
}
test('weighted score, boundaries and missing evidence',()=>{
  assert.equal(aggregate([]).total,null);
  const r=ratings(100);r.independent.score=0;
  assert.equal(aggregate([{ratings:r}]).total,90);
  assert.deepEqual([59.99,60,74.99,75,89.99,90,100].map(level),['Chưa đạt','Foundation','Foundation','Proficient','Proficient','Mastery','Mastery']);
  assert.throws(()=>validateRatings({critical:{score:100,reason:'x'}}));
  assert.equal(eligibility([...evidence,...evidence]).counts.challenges,10);
  assert.equal(eligibility([{...evidence[0],ratings:{}}]).counts.challenges,0);
  assert.equal(eligibility(evidence,{status:'failed',final_score:40,result:{total:100},independent:true}).eligible,false);
  assert.equal(eligibility(evidence,{status:'passed',rubric_version:'competency-v1',final_score:60,result:{total:60},independent:true}).eligible,true);
});
test('start, save, submit, review and fresh questions; no answer keys leak',async()=>{
  const {service,store,rows}=fixture(),user={id:'learner'};
  const a=await service.act({action:'start'},user);
  assert.equal(a.questions.length,5);assert.ok(a.questions.every(q=>!('key'in q)));
  assert.equal((await service.act({action:'start'},user)).id,a.id);
  await assert.rejects(service.act({action:'submit',attemptId:a.id,answers:{}},user));
  const answers={f1:0,f2:1,f3:2,f4:1,f5:'Cần nhóm đối chứng và mẫu lớn trước khi quyết định.'};
  await service.act({action:'save',attemptId:a.id,answers},user);
  const submitted=await service.act({action:'submit',attemptId:a.id,answers},user);
  assert.equal(submitted.status,'needs_review');assert.equal(submitted.result,undefined);
  await assert.rejects(service.act({action:'submit',attemptId:a.id,answers},user));
  await assert.rejects(reviewAssessment(store,rows[0],{ratings:ratings(100),explanationScore:20,independent:true},{id:'learner',role:'admin'}));
  await reviewAssessment(store,rows[0],{ratings:ratings(75),explanationScore:15,independent:true},{id:'reviewer',role:'admin'});
  assert.equal(rows[0].status,'passed');assert.equal(rows[0].final_score,95);
  const next=await service.act({action:'start'},user);
  assert.ok(next.questions.every(q=>!a.questions.some(old=>old.id===q.id)));
});
test('reject spoofed scores, ownership, unauthenticated calls and unauthorized evidence',async()=>{
  const {service}=fixture(),user={id:'learner'};
  await assert.rejects(service.snapshot(null));
  await assert.rejects(service.act({action:'start',score:100},user));
  await assert.rejects(service.act({action:'recordEvidence'},user),{status:403});
  await assert.rejects(service.act({action:'review'},user),{status:403});
  const a=await service.act({action:'start'},user);
  await assert.rejects(service.act({action:'save',attemptId:a.id,answers:{}},{id:'other'}),{status:404});
});
test('HTTP competency branch enforces existing authentication and rejects forged fields',async(t)=>{
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_ANON_KEY='test-anon-key';
  t.after(()=>{if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=oldKey;});
  const {store}=fixture();
  const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
  const denied=createLearningRecordsHandler({sessionResolver:async()=>{throw Object.assign(new Error('Unauthorized'),{status:401});},competencyStoreFactory:()=>store});
  const res=response();await denied({method:'GET',query:{view:'competency'}},res);assert.equal(res.code,401);
  const handler=createLearningRecordsHandler({sessionResolver:async()=>({user:{id:'learner',email:'l@example.test'}}),competencyStoreFactory:()=>store});
  const forged=response();await handler({method:'POST',query:{view:'competency'},body:{action:'start',learnerId:'other',score:100}},forged);assert.equal(forged.code,400);
});
test('bank exhaustion, duplicate questions, wrong version and blank explanation fail closed',async()=>{
  const {service,rows}=fixture(),user={id:'learner'};
  for(let i=0;i<2;i++) {
    const a=await service.act({action:'start'},user);
    assert.equal(new Set(a.questions.map(q=>q.id)).size,5);
    const answers=Object.fromEntries(a.questions.map(q=>[q.id,q.open?'    ':0]));
    await assert.rejects(service.act({action:'submit',attemptId:a.id,answers},user),{status:400});
    answers[a.questions.find(q=>q.open).id]='Giải thích tự thực hiện và kiểm chứng.';
    await service.act({action:'submit',attemptId:a.id,answers},user);
  }
  await assert.rejects(service.act({action:'start'},user),{status:409});
  rows[0].status='in_progress';rows[0].rubric_version='unknown';
  await assert.rejects(service.act({action:'save',attemptId:rows[0].id,answers:{}},user),{status:409});
  rows[0].rubric_version='competency-v1';rows[0].question_ids=['f1','f1','f3','f4','f5'];
  await assert.rejects(service.act({action:'save',attemptId:rows[0].id,answers:{}},user),{status:409});
});
test('parallel submissions cannot overwrite answers or create a stranded submitted state',async()=>{
  const {service,rows}=fixture(),user={id:'learner'};
  const a=await service.act({action:'start'},user);
  const body={action:'submit',attemptId:a.id,answers:{f1:0,f2:1,f3:2,f4:1,f5:'Independent explanation without assistance.'}};
  const results=await Promise.allSettled([service.act(body,user),service.act(body,user)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  assert.equal(rows[0].status,'needs_review');
  await assert.rejects(service.act({...body,action:'save'},user),{status:409});
});
test('concurrent starts recover unique-index conflicts to the same active attempt',async()=>{
  const {store,rows}=fixture();
  store.insert=async row=>{if(rows.some(a=>a.status==='in_progress'))throw Object.assign(new Error('unique index'),{status:409});rows.push(row);return row;};
  const service=createCompetencyService(store);
  const [a,b]=await Promise.all([service.act({action:'start'},{id:'learner'}),service.act({action:'start'},{id:'learner'})]);
  assert.equal(a.id,b.id);assert.equal(rows.length,1);
});
test('only another admin may review once; missing score and old rubric never qualify',async()=>{
  const {service,store,rows}=fixture(),user={id:'learner'};
  const a=await service.act({action:'start'},user);
  const review={ratings:ratings(100),explanationScore:20,independent:true};
  await assert.rejects(reviewAssessment(store,rows[0],review,{id:'admin',role:'admin'}),{status:409});
  await service.act({action:'submit',attemptId:a.id,answers:{f1:0,f2:1,f3:2,f4:1,f5:'Independent explanation without assistance.'}},user);
  await assert.rejects(reviewAssessment(store,rows[0],review,{id:'other',role:'user'}),{status:403});
  const results=await Promise.allSettled([reviewAssessment(store,rows[0],review,{id:'admin',role:'admin'}),reviewAssessment(store,rows[0],review,{id:'admin2',role:'admin'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  for(const final of [{status:'passed',result:{total:100}}, {status:'passed',rubric_version:'old',final_score:100,result:{total:100}}, {status:'passed',rubric_version:'competency-v1',final_score:NaN,result:{total:100}}]) assert.equal(eligibility(evidence,final).eligible,false);
});
