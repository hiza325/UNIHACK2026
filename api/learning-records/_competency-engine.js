export const RUBRIC_VERSION = 'competency-v1';
export const SKILLS = [
  { id: 'critical', name: 'Critical Thinking', weight: .25, criterion: 'Nhận diện giả định, lỗi lập luận và chất lượng bằng chứng.' },
  { id: 'problem', name: 'Problem Solving', weight: .25, criterion: 'Chọn phương pháp phù hợp, thực hiện và kiểm tra kết quả.' },
  { id: 'correction', name: 'Self-Correction', weight: .2, criterion: 'Chỉ ra lỗi, sửa phương pháp và kiểm chứng lời giải mới.' },
  { id: 'reasoning', name: 'Reasoning & Explanation', weight: .2, criterion: 'Giải thích quyết định bằng chuỗi lập luận và bằng chứng rõ ràng.' },
  { id: 'independent', name: 'Independent Learning', weight: .1, criterion: 'Tự lựa chọn, giải thích và kiểm tra phương pháp không dùng trợ giúp.' },
];
export const ANCHORS = ['0: Không có bằng chứng đúng', '25: Nhận diện một phần, còn lỗi lớn', '50: Đúng một phần, thiếu kiểm chứng', '75: Đúng, có giải thích và kiểm chứng', '100: Đúng đầy đủ, nêu giới hạn và phương án thay thế'];
export const SITUATIONS = ['reasoning_error', 'evidence', 'scenario', 'method_correction', 'decision'];
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function validateRatings(ratings) {
  if (!ratings || Object.keys(ratings).length !== 5) fail('Cần đủ 5 năng lực');
  for (const { id } of SKILLS) {
    const r = ratings[id];
    if (!r || ![0,25,50,75,100].includes(r.score) || typeof r.reason !== 'string' || r.reason.trim().length < 10 || r.reason.length > 1600) fail('Điểm hoặc lý do không đúng rubric');
  }
  return ratings;
}
export function level(score) { return score == null ? 'Chưa đánh giá' : score < 60 ? 'Chưa đạt' : score < 75 ? 'Foundation' : score < 90 ? 'Proficient' : 'Mastery'; }
export function validEvidence(evidence) {
  return [...new Map(evidence.filter(e => {
    if(!e||e.rubric_version!==RUBRIC_VERSION||e.valid!==true||!e.session_id||!e.challenge_id||!SITUATIONS.includes(e.situation))return false;
    try {validateRatings(e.ratings);return true;} catch {return false;}
  }).map(e=>[e.challenge_id,e])).values()];
}
export function aggregate(records) {
  const scores = Object.fromEntries(SKILLS.map(({ id }) => [id, records.length ? records.reduce((sum, r) => sum + r.ratings[id].score, 0) / records.length : null]));
  const total = records.length ? Math.round(SKILLS.reduce((sum, s) => sum + scores[s.id] * s.weight, 0) * 100) / 100 : null;
  return { scores, total, level: level(total) };
}
export function eligibility(evidence, final = null) {
  const unique = validEvidence(evidence);
  const counts = { challenges: unique.length, sessions: new Set(unique.map(e => e.session_id)).size, situations: new Set(unique.map(e => e.situation)).size };
  const missing = [];
  if (counts.challenges < 10) missing.push(`Cần ${10-counts.challenges} thử thách hợp lệ nữa`);
  if (counts.sessions < 3) missing.push(`Cần ${3-counts.sessions} phiên học nữa`);
  if (counts.situations < 3) missing.push(`Cần ${3-counts.situations} loại tình huống nữa`);
  const canStart = missing.length === 0;
  const independent = unique.some(e => e.independent === true) || final?.independent === true;
  if (!independent) missing.push('Cần một nhiệm vụ giải thích độc lập được xác nhận');
  if (!final || final.rubric_version!==RUBRIC_VERSION || final.status !== 'passed' || !Number.isFinite(final.final_score) || final.final_score < 60 || final.final_score > 100) missing.push('Cần vượt qua 5 thử thách cuối mới với điểm tối thiểu 60%');
  if (!Number.isFinite(final?.result?.total) || final.result.total < 60 || final.result.total > 100) missing.push('Điểm năng lực chính thức chưa đạt 60');
  return { counts, canStart, independent, missing, eligible: missing.length === 0, issuanceEnabled: false };
}
