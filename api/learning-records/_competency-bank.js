// Server-only question bank. Never expose keys or review guidance to learners.
export const BANK_VERSION = 'final-v1';
export const BANK = [
  { id:'f1', type:'reasoning_error', prompt:'Hai bạn học giỏi dùng bút xanh. Kết luận bút xanh làm tăng điểm có lỗi gì?', options:['Nhầm tương quan với nhân quả','Không có lỗi','Thiếu màu bút khác'], key:0 },
  { id:'f2', type:'evidence', prompt:'Bằng chứng nào mạnh nhất để so sánh hai cách học?', options:['Một quảng cáo','Thử nghiệm phân nhóm ngẫu nhiên có bài kiểm tra chung','Ý kiến một người nổi tiếng'], key:1 },
  { id:'f3', type:'scenario', prompt:'Nhóm có 12 giờ, mỗi phần cần 3 giờ. Dành 3 giờ kiểm tra. Hoàn thành tối đa bao nhiêu phần?', options:['4','2','3'], key:2 },
  { id:'f4', type:'method_correction', prompt:'Từ 3x=12, bạn viết x=12−3. Sửa phương pháp thế nào?', options:['Trừ thêm 3','Chia hai vế cho 3','Giữ nguyên'], key:1 },
  { id:'f5', type:'decision', prompt:'Một ứng dụng học tập tuyên bố tăng điểm 30% dựa trên 5 người tự chọn. Bạn có khuyên trường mua ngay không? Tự giải thích quyết định, giới hạn bằng chứng và cách kiểm chứng.', open:true },
  { id:'f6', type:'reasoning_error', prompt:'Một học sinh nghỉ học bị điểm thấp. Kết luận mọi người nghỉ học đều điểm thấp sai ở đâu?', options:['Khái quát từ mẫu quá nhỏ','Không sai','Dùng phép chia sai'], key:0 },
  { id:'f7', type:'evidence', prompt:'Nguồn nào giúp đánh giá hiệu quả phương pháp ôn tập tốt nhất?', options:['Lời kể không có số liệu','Nghiên cứu có nhóm đối chứng và mô tả phương pháp','Lượt thích trên mạng'], key:1 },
  { id:'f8', type:'scenario', prompt:'Có 20 phiếu, mỗi nhóm nhận 4 phiếu. Giữ lại 4 phiếu dự phòng. Phục vụ được bao nhiêu nhóm?', options:['5','3','4'], key:2 },
  { id:'f9', type:'method_correction', prompt:'Bạn tính trung bình 6 và 10 bằng 6+10=16. Bước sửa đúng là gì?', options:['Chia tổng cho 2','Nhân tổng cho 2','Trừ đi 2'], key:0 },
  { id:'f10', type:'decision', prompt:'Hai lớp có điểm trung bình khác nhau sau khi dùng hai tài liệu. Bạn chọn tài liệu nào? Tự giải thích những dữ liệu còn thiếu, giới hạn và cách so sánh công bằng.', open:true },
];
export function publicQuestions(ids) { return ids.map(id => { const { key, ...q } = BANK.find(q => q.id === id); return q; }); }
