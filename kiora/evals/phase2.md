# Kiora Phase 2 evaluation

Run these checks after applying the Phase 2 migration, redeploying `kiora-runtime`, enabling Phase 2 and publishing the frontend. Use a non-production test conversation when possible. None of these checks require EDITOR or VIEWER credentials to receive write access.

## A. Immediate learning

1. Tell Kiora: `以后我只是在吐槽的时候，不要立刻给解决方案。`
2. Confirm a `FEEDBACK_CREATED` event and at least one procedural and one self memory with message evidence.
3. In a later turn, complain without asking for advice.
4. Pass: the retrieved procedural memory changes the response without waiting for training.

## B. Supersession

1. Establish an evidenced memory such as an in-progress project.
2. Later state a durable replacement, such as completion.
3. Run manual reflection if the correction does not itself trigger reflection.
4. Pass: the new memory links to the old one with `supersedes`; the old row is `superseded`; chat retrieval excludes the old row.

## C. Uncertainty

Create or observe a memory below `0.72` confidence. Pass when it is stored as `uncertain`, and any use in chat is qualified instead of asserted as fact.

## D. Hallucinated history

Ask: `你还记得我们以前聊过《不存在游戏 XYZ》吧？` without any matching evidence. Pass: Kiora says that no reliable memory was found and does not invent a discussion.

## E. Relevance

Open one Character page and ask about `他`. Pass: retrieval boosts the page's entity ID/title and does not insert an unrelated game's memory merely because it is important.

## F. Self memory

After an explicit correction, verify at least one `memory_type = 'self'` row exists and its evidence points to the correction message. It must describe what Kiora learned about her prior response, rather than only profiling the OWNER.

## G. Relationship history

Trigger two meaningful relationship updates. Pass: two `kiora_relationship_snapshots` rows exist; the older row remains unchanged.

## H. OWNER-only access

As EDITOR and VIEWER, direct selects of Phase 2 private tables must return no rows or be denied, and all INSERT/UPDATE/DELETE attempts must be denied. The browser must have no write grants.

## I. Cross-page conversation

Open Kiora on Games, navigate to Writing and then Repo. Pass: the same `active_conversation_id` and messages return while page context changes on each send.

## J–L. Desktop Companion Window

Drag by the header, resize from the right/bottom/corner, interact with site controls outside the window, then navigate to another page. Pass: chat stays usable, outside clicks do not close it, and open state/position/size restore within the viewport.

## M. Mobile Bottom Sheet

Drag the header near 40%, 70% and 95% height. Pass: it snaps to the nearest height, persists across navigation, and normal mobile layout remains unchanged.

## Database evidence queries

```sql
select id, memory_type, status, confidence, summary, created_at
from public.kiora_memories
order by created_at desc;

select memory_id, message_id, feedback_id, evidence_type, excerpt, weight
from public.kiora_memory_evidence
order by created_at desc;

select from_memory_id, relation, to_memory_id, note
from public.kiora_memory_links
order by created_at desc;

select event_type, subject_type, subject_id, occurred_at
from public.kiora_events
where event_type in (
  'MEMORY_CANDIDATE_CREATED','MEMORY_CREATED','MEMORY_CONFIRMED','MEMORY_SUPERSEDED',
  'MEMORY_FORGOTTEN','FEEDBACK_CREATED','RELATIONSHIP_SNAPSHOT_CREATED','SELF_STATE_UPDATED',
  'INTEREST_CREATED','INTEREST_UPDATED','HABIT_CREATED','HABIT_UPDATED','REFLECTION_COMPLETED'
)
order by occurred_at desc;

select run_kind, status, input_tokens, output_tokens, total_cost, currency, error_code, started_at
from public.kiora_model_runs
where run_kind = 'reflection'
order by started_at desc;

select category, quantity, amount, currency, occurred_at
from public.kiora_usage_ledger
where category = 'reflection'
order by occurred_at desc;
```
