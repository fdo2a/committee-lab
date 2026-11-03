import { sqliteTable, text, integer, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
export const account = sqliteTable("paper_account", {
  id: text("id").primaryKey(),
  state: text("state").notNull(),
  revision: integer("revision").notNull().default(1),
  metadata: text("metadata").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});
export const runLog=sqliteTable('run_log',{
 id:integer('id').primaryKey(),startedAt:text('started_at').notNull(),status:text('status').notNull(),report:text('report').notNull().default('{}'),
});
export const reviewWindow=sqliteTable('review_window',{
 id:text('id').primaryKey(),sessionKey:text('session_key').notNull().unique(),startedAt:integer('started_at').notNull(),deadline:integer('deadline').notNull(),rounds:integer('rounds').notNull().default(0),
});
export const reviewJob=sqliteTable('review_job',{
 id:text('id').primaryKey(),windowId:text('window_id').notNull(),scope:text('scope').notNull(),digest:text('digest').notNull(),immutableDigest:text('immutable_digest').notNull(),codeDigest:text('code_digest').notNull(),revision:integer('revision').notNull(),market:text('market').notNull(),phase:text('phase').notNull(),round:integer('round').notNull(),status:text('status').notNull(),chunkCount:integer('chunk_count').notNull().default(0),result:text('result'),claimId:text('claim_id'),createdAt:integer('created_at').notNull(),
},table=>[uniqueIndex('review_job_request_unique').on(table.windowId,table.scope,table.digest)]);
export const reviewEvidence=sqliteTable('review_evidence',{
 jobId:text('job_id').notNull(),part:integer('part').notNull(),body:text('body').notNull(),
},table=>[primaryKey({columns:[table.jobId,table.part]})]);
export const accountPart=sqliteTable('paper_account_part',{
 id:text('id').notNull(),partSet:text('part_set').notNull(),part:integer('part').notNull(),body:text('body').notNull(),
},table=>[primaryKey({columns:[table.id,table.partSet,table.part]})]);
