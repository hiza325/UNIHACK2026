import {test,expect} from '@playwright/test';
import {publicQuestions} from '../api/learning-records/_competency-bank.js';
test('public HTTP cannot download question keys or server scoring modules',async({request})=>{
  for(const path of ['/api/learning-records/_competency-bank.js','/api/learning-records/_competency-service.js','/api/learning-records/_competency-engine.js']) {
    const response=await request.get(path);expect(response.status()).toBe(404);
  }
  const script=await (await request.get('/competency-passport.js')).text();
  expect(script).not.toContain('_competency-bank');
});
test('assessment form submits answers only and shows review state',async({page})=>{
  const scores={critical:null,problem:null,correction:null,reasoning:null,independent:null};
  const attempt={id:'attempt',status:'in_progress',questions:publicQuestions(['f1','f2','f3','f4','f5']),answers:{},created_at:'2026-11-06'};
  let submitted;
  await page.route('**/api/learning-records?view=competency',route=>{
    if(route.request().method()==='POST') {submitted=route.request().postDataJSON();attempt.status='needs_review';attempt.questions=[];return route.fulfill({json:attempt});}
    return route.fulfill({json:{progress:{scores},official:{scores,total:null,level:'Chưa đánh giá'},eligibility:{missing:['Chờ đánh giá độc lập'],canStart:true,eligible:false},history:[attempt]}});
  });
  await page.goto('/competency-preview.html');
  for(const id of ['f1','f2','f3','f4']) await page.locator(`input[name="${id}"]`).first().check();
  await page.locator('textarea').fill('Cần kiểm chứng bằng nhóm đối chứng trước khi chọn.');
  await page.getByRole('button',{name:'Nộp để đánh giá'}).click();
  await expect(page.locator('form')).toHaveCount(0);
  expect(Object.keys(submitted).sort()).toEqual(['action','answers','attemptId']);
  await page.getByText('Lịch sử đánh giá').click();
  await expect(page.locator('details')).toContainText('needs_review');
});
test('passport component shows unavailable evidence without inventing scores',async({page})=>{
  await page.route('**/api/learning-records?view=competency',route=>route.fulfill({status:503,json:{error:'Migration pending'}}));
  await page.goto('/');
  await page.evaluate(async()=>{await import('/competency-passport.js');document.body.append(document.createElement('competency-passport'));});
  const panel=page.locator('competency-passport');
  await expect(panel).toContainText('Migration pending');
  await expect(panel.locator('article')).toHaveCount(5);
  await expect(panel).toContainText('Chưa đánh giá');
  await expect(panel.getByRole('button',{name:'Bắt đầu 5 thử thách mới'})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});
