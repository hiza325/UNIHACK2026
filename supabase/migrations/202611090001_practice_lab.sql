-- Practice Lab backend support.
-- Additive only: existing users, learning records, credentials and achievements are preserved.
-- Server-owned challenge answers; public clients cannot read challenge rows directly.

create extension if not exists pgcrypto;

create table if not exists public.practice_challenges (
  slug text primary key check (char_length(slug) between 2 and 80),
  subject_key text not null check (char_length(subject_key) between 2 and 40),
  minutes smallint not null check (minutes between 1 and 120),
  correct_option smallint not null check (correct_option between 0 and 7),
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  challenge_slug text not null references public.practice_challenges(slug) on delete restrict,
  client_attempt_id uuid not null,
  selected_option smallint not null check (selected_option between 0 and 7),
  is_correct boolean not null,
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (learner_id, client_attempt_id)
);

create index if not exists practice_challenges_active_sort_idx
  on public.practice_challenges (is_active, sort_order, slug);

create index if not exists practice_attempts_learner_attempted_idx
  on public.practice_attempts (learner_id, attempted_at desc);

create index if not exists practice_attempts_learner_challenge_idx
  on public.practice_attempts (learner_id, challenge_slug);

create or replace function public.set_practice_challenge_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists practice_challenges_set_updated_at on public.practice_challenges;
create trigger practice_challenges_set_updated_at
before update on public.practice_challenges
for each row execute function public.set_practice_challenge_updated_at();

-- RLS: direct Supabase clients cannot read answers or write attempts.
-- The Practice API uses the service role and enforces ownership server-side.
alter table public.practice_challenges enable row level security;
alter table public.practice_attempts enable row level security;

-- No policies are granted to anon/authenticated. Service role bypasses RLS.

-- Read-only summary view for SQL reporting. It intentionally does not expose
-- answers or user-selected options.
create or replace view public.practice_progress with (security_invoker = true) as
select
  a.learner_id,
  c.subject_key,
  count(distinct c.slug) filter (where c.slug is not null) as total_challenges,
  count(distinct a.challenge_slug) filter (where a.is_correct) as solved_challenges,
  count(a.id) as total_attempts,
  count(a.id) filter (where a.is_correct) as correct_attempts,
  max(a.attempted_at) as last_attempted_at
from public.practice_challenges c
left join public.practice_attempts a on a.challenge_slug = c.slug
where c.is_active
group by a.learner_id, c.subject_key;

comment on table public.practice_challenges is 'Server-owned Practice Lab challenge definitions, including correct answers.';
comment on table public.practice_attempts is 'Practice Lab attempts owned by a learner and written through the API only.';

insert into public.practice_challenges (slug, subject_key, minutes, correct_option, sort_order, is_active, content)
values
('chain-rule', 'calculus', 3, 1, 0, true, '{"vi":{"title":"Đạo hàm hàm hợp","question":"Cho f(x) = (3x² + 1)⁴. Đạo hàm f′(x) là:","options":["12x(3x² + 1)³","24x(3x² + 1)³","4(3x² + 1)³","6x(3x² + 1)⁴"],"level":"Trung bình","explanation":"Áp dụng quy tắc dây chuyền: 4(3x² + 1)³ · 6x = 24x(3x² + 1)³.","source":"OpenStax Calculus Vol. 1, §3.6"},"en":{"title":"Chain rule","question":"For f(x) = (3x² + 1)⁴, the derivative f′(x) is:","options":["12x(3x² + 1)³","24x(3x² + 1)³","4(3x² + 1)³","6x(3x² + 1)⁴"],"level":"Intermediate","explanation":"Chain rule: 4(3x² + 1)³ · 6x = 24x(3x² + 1)³.","source":"OpenStax Calculus Vol. 1, §3.6"},"jp":{"title":"合成関数の微分","question":"f(x) = (3x² + 1)⁴ の導関数 f′(x) は？","options":["12x(3x² + 1)³","24x(3x² + 1)³","4(3x² + 1)³","6x(3x² + 1)⁴"],"level":"中級","explanation":"連鎖律より 4(3x² + 1)³ · 6x = 24x(3x² + 1)³。","source":"OpenStax Calculus Vol. 1, §3.6"}}'::jsonb),
  ('simplify-expression', 'algebra', 2, 0, 1, true, '{"vi":{"title":"Rút gọn biểu thức","question":"Rút gọn 2(x + 3) − 2x.","options":["6","x + 6","2x + 6","0"],"level":"Cơ bản","explanation":"2(x + 3) − 2x = 2x + 6 − 2x = 6.","source":"OpenStax Elementary Algebra, §1.6"},"en":{"title":"Simplify the expression","question":"Simplify 2(x + 3) − 2x.","options":["6","x + 6","2x + 6","0"],"level":"Basic","explanation":"2(x + 3) − 2x = 2x + 6 − 2x = 6.","source":"OpenStax Elementary Algebra, §1.6"},"jp":{"title":"式を簡単にする","question":"2(x + 3) − 2x を簡単にすると？","options":["6","x + 6","2x + 6","0"],"level":"基礎","explanation":"2(x + 3) − 2x = 2x + 6 − 2x = 6。","source":"OpenStax Elementary Algebra, §1.6"}}'::jsonb),
  ('python-reverse-list', 'programming', 2, 0, 2, true, '{"vi":{"title":"Python: đảo danh sách","question":"Kết quả của [1, 2, 3][::-1] là gì?","options":["[3, 2, 1]","[1, 2, 3]","[1, 3]","Lỗi cú pháp"],"level":"Cơ bản","explanation":"Slice với bước −1 duyệt danh sách từ cuối về đầu: [3, 2, 1].","source":"Python docs · Sequence types"},"en":{"title":"Python: reverse a list","question":"What is the result of [1, 2, 3][::-1]?","options":["[3, 2, 1]","[1, 2, 3]","[1, 3]","Syntax error"],"level":"Basic","explanation":"A slice with step −1 walks the list backwards: [3, 2, 1].","source":"Python docs · Sequence types"},"jp":{"title":"Python：リストを逆順に","question":"[1, 2, 3][::-1] の結果は？","options":["[3, 2, 1]","[1, 2, 3]","[1, 3]","構文エラー"],"level":"基礎","explanation":"ステップ −1 のスライスは末尾から先頭へ進みます：[3, 2, 1]。","source":"Python docs · Sequence types"}}'::jsonb),
  ('necessary-sufficient', 'logic', 3, 0, 3, true, '{"vi":{"title":"Điều kiện cần và đủ","question":"Nếu một số chia hết cho 4 thì số đó chắc chắn:","options":["Chia hết cho 2","Chia hết cho 8","Là số nguyên tố","Là số lẻ"],"level":"Trung bình","explanation":"Mọi bội của 4 đều có dạng 4k = 2(2k), nên luôn chia hết cho 2.","source":"OpenStax Contemporary Mathematics · Logic"},"en":{"title":"Necessary and sufficient","question":"If a number is divisible by 4, it must be:","options":["Divisible by 2","Divisible by 8","Prime","Odd"],"level":"Intermediate","explanation":"Every multiple of 4 has the form 4k = 2(2k), so it is always divisible by 2.","source":"OpenStax Contemporary Mathematics · Logic"},"jp":{"title":"必要条件と十分条件","question":"ある数が4で割り切れるなら、必ず成り立つことは？","options":["2で割り切れる","8で割り切れる","素数である","奇数である"],"level":"中級","explanation":"4の倍数は 4k = 2(2k) と表せるため、必ず2で割り切れます。","source":"OpenStax Contemporary Mathematics · Logic"}}'::jsonb),
  ('basic-probability', 'statistics', 2, 1, 4, true, '{"vi":{"title":"Xác suất cơ bản","question":"Tung một đồng xu cân bằng hai lần. Xác suất xuất hiện đúng một mặt ngửa là:","options":["1/4","1/2","3/4","1"],"level":"Cơ bản","explanation":"Có 4 kết quả đồng khả năng: NN, NS, SN, SS. Hai kết quả có đúng một mặt ngửa nên xác suất là 2/4 = 1/2.","source":"OpenStax Introductory Statistics · Probability"},"en":{"title":"Basic probability","question":"A fair coin is tossed twice. The probability of exactly one head is:","options":["1/4","1/2","3/4","1"],"level":"Basic","explanation":"There are four equally likely outcomes: HH, HT, TH, TT. Two contain exactly one head, so the probability is 2/4 = 1/2.","source":"OpenStax Introductory Statistics · Probability"},"jp":{"title":"確率の基礎","question":"公平なコインを2回投げるとき、表がちょうど1回出る確率は？","options":["1/4","1/2","3/4","1"],"level":"基礎","explanation":"同様に確からしい4通りのうち、表が1回の結果は2通りなので 2/4 = 1/2 です。","source":"OpenStax Introductory Statistics · Probability"}}'::jsonb),
  ('average-speed', 'physics', 3, 1, 5, true, '{"vi":{"title":"Vận tốc trung bình","question":"Một vật đi được 120 m trong 10 s. Vận tốc trung bình là:","options":["10 m/s","12 m/s","20 m/s","1200 m/s"],"level":"Cơ bản","explanation":"Vận tốc trung bình bằng quãng đường chia thời gian: 120 / 10 = 12 m/s.","source":"OpenStax Physics · Motion"},"en":{"title":"Average speed","question":"An object travels 120 m in 10 s. Its average speed is:","options":["10 m/s","12 m/s","20 m/s","1200 m/s"],"level":"Basic","explanation":"Average speed is distance divided by time: 120 / 10 = 12 m/s.","source":"OpenStax Physics · Motion"},"jp":{"title":"平均の速さ","question":"物体が120 mを10秒で進みました。平均の速さは？","options":["10 m/s","12 m/s","20 m/s","1200 m/s"],"level":"基礎","explanation":"平均の速さは距離÷時間なので、120 / 10 = 12 m/s です。","source":"OpenStax Physics · Motion"}}'::jsonb)
) on conflict (slug) do nothing;
