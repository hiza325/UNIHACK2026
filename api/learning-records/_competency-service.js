import { randomUUID } from 'node:crypto';
import { RUBRIC_VERSION, SKILLS, ANCHORS, SITUATIONS, aggregate, eligibility, validateRatings, validEvidence, fail } from './_competency-engine.js';
import { certificateEligibility } from './_competency-certificate.js';
import { BANK, BANK_VERSION, publicQuestions } from './_competency-bank.js';
export function createCompetencyService(store) {
  const owner = user => { if (!user?.id) fail('Authentication required',401); return user.id; };
  function safe(row) { return { id:row.id, status:row.status, created_at:row.created_at, final_score:row.final_score, result:row.result, independent:row.independent, rubric_version:row.rubric_version, bank_version:row.bank_version, questions:row.status==='in_progress' ? publicQuestions(row.question_ids) : [], answers:row.status==='in_progress' ? row.answers : undefined }; }
  async function snapshot(user) {
    const learner=owner(user);
    const [evidence, attempts]=await Promise.all([store.evidence(learner),store.attempts(learner)]);
    const valid=validEvidence(evidence);
    const reviewed=attempts.find(a=>['passed','failed'].includes(a.status)&&a.rubric_version===RUBRIC_VERSION&&a.bank_version===BANK_VERSION);
    const snap = { rubricVersion:RUBRIC_VERSION, skills:SKILLS, anchors:ANCHORS, progress:aggregate(valid), official:reviewed?.result || aggregate([]), eligibility:eligibility(valid,reviewed), history:attempts.map(safe), status:attempts[0]?.status || 'not_started' };
    snap.certificateEligibility = certificateEligibility(snap);
    return snap;
  }
  return { snapshot, async act(body,user) {
    const learner=owner(user);
    if(!body||typeof body!=='object'||Array.isArray(body)) fail('Invalid request');
    if(['recordEvidence','review'].includes(body.action)) {
      if(user.role!=='admin') fail('Forbidden',403);
      const allowed=body.action==='review'?['action','attemptId','review']:['action','learnerId','submissionId','situation','ratings','independent'];
      if(Object.keys(body).some(k=>!allowed.includes(k))) fail('Unexpected fields');
      const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
      if(body.action==='review') {
        if(!uuid(body.attemptId)) fail('Invalid attempt');
        const attempt=await store.findAttempt(body.attemptId);if(!attempt) fail('Not found',404);
        return safe(await reviewAssessment(store,attempt,body.review,user));
      }
      if(!uuid(body.learnerId)||!uuid(body.submissionId)||body.learnerId===learner||!SITUATIONS.includes(body.situation)||typeof body.independent!=='boolean') fail('Invalid evidence');
      validateRatings(body.ratings);
      const source=await store.findSource(body.submissionId,body.learnerId);
      if(!source||source.analysis_state!=='analyzed') fail('Owned analyzed submission required',400);
      // One learning problem/session is one challenge, regardless of revision/chat count.
      return store.insertEvidence({learner_id:body.learnerId,submission_id:source.id,session_id:source.session_id,challenge_id:source.session_id,situation:body.situation,ratings:body.ratings,independent:body.independent,rubric_version:RUBRIC_VERSION,valid:true,reviewer_id:learner});
    }
    if (Object.keys(body).some(k=>!['action','attemptId','answers'].includes(k))) fail('Unexpected fields');
    const [evidence,attempts]=await Promise.all([store.evidence(learner),store.attempts(learner)]);
    if(body.action==='start') {
      if(!eligibility(evidence).canStart) fail('Chưa đủ bằng chứng để bắt đầu',403);
      const active=attempts.find(a=>a.status==='in_progress'); if(active) return safe(active);
      const used=new Set([...evidence.map(e=>e.challenge_id),...attempts.flatMap(a=>a.question_ids)]);
      const selected=['reasoning_error','evidence','scenario','method_correction','decision'].map(type=>BANK.find(q=>q.type===type&&!used.has(q.id)));
      if(selected.some(q=>!q)) fail('Cần phiên bản ngân hàng câu hỏi mới',409);
      try {
        return safe(await store.insert({ id:randomUUID(), learner_id:learner, status:'in_progress', rubric_version:RUBRIC_VERSION, bank_version:BANK_VERSION, question_ids:selected.map(q=>q.id), answers:{} }));
      } catch(error) {
        if(error.status!==409) throw error;
        const active=(await store.attempts(learner)).find(a=>a.status==='in_progress');
        if(active) return safe(active);
        throw error;
      }
    }
    const attempt=attempts.find(a=>a.id===body.attemptId); if(!attempt) fail('Không tìm thấy bài đánh giá',404);
    validateAttempt(attempt);
    if(attempt.status!=='in_progress') fail('Bài đã được nộp',409);
    if(!['save','submit'].includes(body.action)) fail('Invalid action');
    const answers=body.answers;
    if(!answers||typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).some(id=>!attempt.question_ids.includes(id))) fail('Invalid answers');
    for(const [id,value] of Object.entries(answers)) {
      const q=BANK.find(q=>q.id===id);
      if(q.open ? typeof value!=='string'||value.length>6000 : !Number.isInteger(value)||value<0||value>=q.options.length) fail('Invalid answer');
    }
    let patch={answers};
    if(body.action==='submit') {
      if(attempt.question_ids.some(id=>answers[id]===undefined||(typeof answers[id]==='string'&&!answers[id].trim()))) fail('Cần hoàn thành cả 5 thử thách');
      const objective=attempt.question_ids.reduce((n,id)=>{const q=BANK.find(q=>q.id===id);return n+(!q.open&&answers[id]===q.key?20:0);},0);
      // Open explanation is never automatically approved; review is mandatory.
      // One conditional write: no durable intermediate state can strand the attempt.
      patch={...patch,status:'needs_review',objective_score:objective,submitted_at:new Date().toISOString()};
      const submitted=await store.update(attempt.id,learner,'in_progress',patch);
      if(!submitted) fail('Concurrent submission',409);
      return safe(submitted);
    }
    const saved=await store.update(attempt.id,learner,'in_progress',patch);
    if(!saved) fail('Concurrent submission',409);
    return safe(saved);
  } };
}

function validateAttempt(attempt) {
  if(attempt.rubric_version!==RUBRIC_VERSION||attempt.bank_version!==BANK_VERSION) fail('Unsupported assessment version',409);
  const ids=attempt.question_ids;
  if(!Array.isArray(ids)||ids.length!==5||new Set(ids).size!==5||ids.some(id=>!BANK.some(q=>q.id===id))||new Set(ids.map(id=>BANK.find(q=>q.id===id).type)).size!==5) fail('Invalid assessment questions',409);
}

// Trusted reviewer integration only. Not exposed as a learner API action.
export async function reviewAssessment(store, attempt, review, reviewer) {
  if(reviewer?.role!=='admin'||reviewer.id===attempt.learner_id) fail('Forbidden',403);
  if(attempt.status!=='needs_review') fail('Not awaiting review',409);
  validateAttempt(attempt);
  if(!Number.isFinite(attempt.objective_score)||attempt.objective_score<0||attempt.objective_score>80) fail('Invalid objective score',409);
  if(!review||Object.keys(review).some(k=>!['ratings','explanationScore','independent'].includes(k))) fail('Invalid review');
  validateRatings(review.ratings);
  if(![0,5,10,15,20].includes(review.explanationScore)||typeof review.independent!=='boolean') fail('Invalid review');
  const result=aggregate([{ratings:review.ratings}]);
  const final_score=attempt.objective_score+review.explanationScore;
  const saved=await store.update(attempt.id,attempt.learner_id,'needs_review',{status:final_score>=60&&result.total>=60&&review.independent?'passed':'failed',final_score,result,independent:review.independent,reviewer_id:reviewer.id,reviewed_at:new Date().toISOString(),review});
  if(!saved) fail('Concurrent review',409);
  return saved;
}
