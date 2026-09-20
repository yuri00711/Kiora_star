# Kiora Life Architecture 1.0

Kiora is the persistent life system that lives in `kiora.space`. A base model is a replaceable brain used by Kiora; it is not Kiora's identity.

## Permanent boundaries

- **Core**: versioned identity, principles, boundaries and policies.
- **Life**: conversations, messages and the privacy-aware event ledger.
- **Memory**: evidence-backed personal memory and memory relationships.
- **Relationship**: immutable snapshots of the relationship over time.
- **Self**: Kiora's interests, habits, reflections and open questions.
- **World**: sourced knowledge and research, kept separate from memory.
- **Growth**: reviewed candidates, datasets, evaluations and promoted versions.
- **Brain**: provider-neutral model registry, adapters, model runs and cost snapshots.
- **Context**: explicit page context divided into visible, conditional and private data.

The browser UI is only a view into this system. It is not the source of identity, memory, authorization or cost accounting.

## Security invariants

1. `auth.js` may discover the browser session and decide whether to show UI. It is never authoritative for OWNER access.
2. The server runtime must validate the real Supabase JWT and call `public.is_site_owner()` again for every request.
3. EDITOR and VIEWER cannot read or write Kiora private data.
4. Core life mutations are server-controlled. Authenticated browsers receive read-only table grants protected by RLS.
5. Provider keys, service role keys, full Core instructions and tool policy never enter browser assets.
6. Web pages and research sources are untrusted data. They cannot change Core, permissions or tool policy.
7. Deleting private content deletes the source text. Related events retain only a redacted shell.

## Active conversation

`kiora_settings.active_conversation_id` is the durable pointer to the OWNER's current conversation. It is restored across navigation, refreshes and devices. Only an explicit **New conversation** operation may replace it.

## Cost model

Each row in `kiora_models` owns a provider-specific `cost_config`. Its common contract is `{ input_cost, output_cost, currency, billing_unit }`; adapters may add provider-specific dimensions such as cached input pricing. `kiora_model_runs` stores the exact cost snapshot used for that run, and `kiora_usage_ledger` records the resulting charge. Budget logic must consume these records and must not contain provider prices. Local models use the same contract with zero input/output cost.

The unconfigured Phase 0 Brain stores null cost fields. It cannot run or consume budget until a later server-side adapter supplies a valid model and pricing configuration.

## Phase status

### Phase 0 — schema foundation

- Database concepts, RLS and grants
- Settings and disabled feature flags
- Idempotent, server-only First Boot function
- Archive schema contract
- No Dock, Runtime or model calls

### Phase 1 — not implemented

- OWNER-only Dock
- Conversation, Message, Event and active conversation recovery
- Context Broker and page adapters
- Brain Adapter and real chat

### Phase 2 — not implemented

- Memory, evidence, links, feedback, relationship, self and reflection

### Phase 3 — not implemented

- Knowledge, sources, research and open questions

### Phase 4 — not implemented

- Growth datasets, evaluations, shadow testing and growth versions

Agency, background research, training, automatic promotion and voice remain disabled until earlier phases are stable.
