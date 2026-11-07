import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRACTICE_CHALLENGES } from './_challenges.js';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const databases = new Map();

export function practiceLocalDbPath(env = process.env) {
  const configured = String(env.PRACTICE_LOCAL_DB_PATH || '').trim();
  if (configured) return isAbsolute(configured) ? configured : join(rootDir, configured);
  return join(rootDir, '.data', 'practice-local.sqlite');
}

function rowChallenge(row) {
  return {
    slug: row.slug,
    subject_key: row.subject_key,
    minutes: row.minutes,
    correct_option: row.correct_option,
    sort_order: row.sort_order,
    is_active: row.is_active === 1,
    content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
  };
}

function rowAttempt(row) {
  return {
    id: row.id,
    challenge_slug: row.challenge_slug,
    client_attempt_id: row.client_attempt_id,
    selected_option: row.selected_option,
    is_correct: row.is_correct === 1,
    attempted_at: row.attempted_at,
  };
}

export function createPracticeLocalStore({ path = practiceLocalDbPath() } = {}) {
  let db = databases.get(path);
  if (!db) {
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec(`
      create table if not exists practice_challenges (
        slug text primary key,
        subject_key text not null,
        minutes integer not null check (minutes between 1 and 120),
        correct_option integer not null check (correct_option between 0 and 7),
        sort_order integer not null default 0,
        is_active integer not null default 1,
        content text not null
      );
      create table if not exists practice_attempts (
        id text primary key,
        learner_id text not null,
        challenge_slug text not null references practice_challenges(slug),
        client_attempt_id text not null,
        selected_option integer not null check (selected_option between 0 and 7),
        is_correct integer not null,
        attempted_at text not null,
        unique (learner_id, client_attempt_id)
      );
      create index if not exists practice_attempts_learner_idx
        on practice_attempts (learner_id, attempted_at);
    `);
    const insert = db.prepare(`
      insert into practice_challenges (slug, subject_key, minutes, correct_option, sort_order, is_active, content)
      values (?, ?, ?, ?, ?, 1, ?)
      on conflict(slug) do update set
        subject_key = excluded.subject_key,
        minutes = excluded.minutes,
        correct_option = excluded.correct_option,
        sort_order = excluded.sort_order,
        is_active = 1,
        content = excluded.content
    `);
    for (const challenge of PRACTICE_CHALLENGES) {
      insert.run(challenge.slug, challenge.subjectKey, challenge.minutes, challenge.correctOption, challenge.sortOrder, JSON.stringify(challenge.content));
    }
    databases.set(path, db);
  }

  return {
    async listChallenges() {
      return db.prepare('select * from practice_challenges where is_active = 1 order by sort_order asc, slug asc').all().map(rowChallenge);
    },
    async findChallenge(slug) {
      const row = db.prepare('select * from practice_challenges where slug = ? and is_active = 1').get(String(slug));
      return row ? rowChallenge(row) : null;
    },
    async listAttempts(learnerId) {
      return db.prepare('select id, challenge_slug, client_attempt_id, selected_option, is_correct, attempted_at from practice_attempts where learner_id = ? order by attempted_at asc, id asc').all(String(learnerId)).map(rowAttempt);
    },
    async findAttempt(learnerId, clientAttemptId) {
      const row = db.prepare('select id, challenge_slug, client_attempt_id, selected_option, is_correct, attempted_at from practice_attempts where learner_id = ? and client_attempt_id = ?').get(String(learnerId), String(clientAttemptId));
      return row ? rowAttempt(row) : null;
    },
    async insertAttempt(record) {
      const existing = await this.findAttempt(record.learner_id, record.client_attempt_id);
      if (existing) return existing;
      const id = randomUUID();
      try {
        db.prepare('insert into practice_attempts (id, learner_id, challenge_slug, client_attempt_id, selected_option, is_correct, attempted_at) values (?, ?, ?, ?, ?, ?, ?)')
          .run(id, String(record.learner_id), String(record.challenge_slug), String(record.client_attempt_id), Number(record.selected_option), record.is_correct ? 1 : 0, String(record.attempted_at));
      } catch (error) {
        // A concurrent request may have inserted the same (learner, client id).
        const duplicate = await this.findAttempt(record.learner_id, record.client_attempt_id);
        if (duplicate) return duplicate;
        throw error;
      }
      return {
        id,
        challenge_slug: String(record.challenge_slug),
        client_attempt_id: String(record.client_attempt_id),
        selected_option: Number(record.selected_option),
        is_correct: Boolean(record.is_correct),
        attempted_at: String(record.attempted_at),
      };
    },
  };
}
