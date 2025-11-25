create table wallet.testing (
  "id" serial primary key,
  "created_at" timestamp with time zone not null default now(),
  "is_even" boolean generated always as (id % 2 = 0) stored,
  "even_description" text
);

insert into wallet.testing (created_at, even_description) values
  (now() - interval '2 day', null),
  (now() - interval '1 day', 'Even description for id 2'),
  (now(), null),
  (now() + interval '1 day', null);

create index testing_created_at_idx on wallet.testing (created_at);

