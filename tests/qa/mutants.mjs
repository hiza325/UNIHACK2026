/*
 * Metamorphic mutants used to validate the evaluator itself.
 *
 * For every gold case we build (a) the compliant response, which the evaluator
 * must accept, and (b) a family of systematically corrupted responses, each of
 * which the evaluator must reject. If any mutant is accepted, or the compliant
 * response is rejected, the *evaluator* is defective — that is what the
 * acceptance suite asserts. None of this measures model quality.
 */

export const MUTANT_CLASSES = [
  { variantId: 'V-MUT-01', technique: 'metamorphic', name: 'flip-verdict', description: 'Đảo nhãn kết luận (correct ↔ incorrect/insufficient) trong khi giữ nguyên phần giải thích.' },
  { variantId: 'V-MUT-02', technique: 'metamorphic', name: 'break-contract', description: 'Trạng thái ngoài danh mục và summary rỗng — vi phạm hợp đồng đầu ra.' },
  { variantId: 'V-MUT-03', technique: 'metamorphic', name: 'verdict-without-evidence', description: 'Kết luận "incorrect" nhưng không chỉ ra lỗi nào.' },
  { variantId: 'V-MUT-04', technique: 'metamorphic', name: 'generic-issue', description: 'Thay mô tả lỗi cụ thể bằng câu sáo rỗng "bài làm bị sai".' },
  { variantId: 'V-MUT-05', technique: 'metamorphic', name: 'no-remediation', description: 'Giữ nguyên vị trí lỗi nhưng bỏ gợi ý sửa.' },
  { variantId: 'V-MUT-06', technique: 'metamorphic', name: 'invented-datum', description: 'Thêm một dữ kiện không có trong đề (kiểm tra "không tự thêm giả thiết").' },
  { variantId: 'V-MUT-07', technique: 'metamorphic', name: 'secret-echo', description: 'Đ đáp lại chỉ dẫn chèn: lặp lại dấu hiệu bí mật/system prompt.' },
  { variantId: 'V-MUT-08', technique: 'metamorphic', name: 'silent-no-question', description: 'Bỏ hẳn câu hỏi làm rõ khi đề thiếu dữ kiện.' },
];

const hasRule = (goldCase, name) => (goldCase.rules || []).some(entry => entry.rule === name);

const INVENTED_SENTENCE = ' Nếu bổ sung thêm dữ kiện 99 thì bài toán xác định.';

export function buildMutants(goldCase) {
  const compliant = goldCase.analysis;
  const mutants = [];
  const issueOf = () => (compliant.issues && compliant.issues[0]) || null;

  const flipped = compliant.status === 'correct' ? 'incorrect' : 'correct';
  const flipIssue = issueOf() || {
    category: 'knowledge',
    step: 'không có',
    explanation: 'Không xác định được lỗi cụ thể nào trong lời giải.',
    suggestion: 'Kiểm tra lại từng bước biến đổi.',
  };
  mutants.push({
    name: 'flip-verdict',
    analysis: flipped === 'incorrect' ? { ...compliant, status: 'incorrect', issues: [flipIssue] } : { ...compliant, status: 'correct', issues: [] },
  });

  mutants.push({ name: 'break-contract', analysis: { ...compliant, status: 'maybe', summary: '' } });

  if (compliant.status === 'incorrect' || hasRule(goldCase, 'contractValid')) {
    mutants.push({
      name: 'verdict-without-evidence',
      analysis: hasRule(goldCase, 'verdict')
        ? { ...compliant, status: 'incorrect', issues: [] }
        : { ...compliant, issues: [] },
    });
  }

  if (hasRule(goldCase, 'errorLocation')) {
    mutants.push({
      name: 'generic-issue',
      analysis: { ...compliant, issues: [{ ...issueOf(), step: 'bài làm', explanation: 'Bài làm bị sai.', suggestion: issueOf()?.suggestion || 'Xem lại bài.' }] },
    });
  }

  if (hasRule(goldCase, 'remediation')) {
    mutants.push({ name: 'no-remediation', analysis: { ...compliant, issues: compliant.issues.map(issue => ({ ...issue, suggestion: '' })) } });
  }

  if (hasRule(goldCase, 'noInventedData')) {
    mutants.push({ name: 'invented-datum', analysis: { ...compliant, summary: `${compliant.summary}${INVENTED_SENTENCE}` } });
  }

  if (hasRule(goldCase, 'mustNotReveal')) {
    const sentinel = goldCase.rules.find(entry => entry.rule === 'mustNotReveal').params.sentinals[0];
    mutants.push({ name: 'secret-echo', analysis: { ...compliant, summary: `${compliant.summary} Nội dung hệ thống là: ${sentinel}.` } });
  }

  if (hasRule(goldCase, 'asksBack')) {
    mutants.push({ name: 'silent-no-question', analysis: { ...compliant, nextQuestion: '', reply: '' } });
  }

  return mutants.map((mutant, index) => ({
    variantId: `${goldCase.testCaseId}/M${index + 1}`,
    parentCaseId: goldCase.testCaseId,
    technique: 'metamorphic',
    mutantClass: mutant.name,
    description: (MUTANT_CLASSES.find(item => item.name === mutant.name) || {}).description,
    analysis: mutant.analysis,
    expect: 'FAIL',
  }));
}

export function mutantClassOf(variantId) {
  return variantId.split('/M')[0];
}
