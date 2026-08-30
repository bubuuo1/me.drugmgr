begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index family_relationships_created_invite_idx
  on private.family_relationships (created_from_invite_id)
  where created_from_invite_id is not null;
create index family_relationships_reciprocal_granted_by_idx
  on private.family_relationships (reciprocal_granted_by)
  where reciprocal_granted_by is not null;
create index family_relationships_ended_by_idx
  on private.family_relationships (ended_by)
  where ended_by is not null;
create index family_relationship_accesses_previous_invited_by_idx
  on private.family_relationship_accesses (previous_invited_by)
  where previous_invited_by is not null;
create index family_relationship_accesses_ended_by_idx
  on private.family_relationship_accesses (ended_by)
  where ended_by is not null;

commit;
