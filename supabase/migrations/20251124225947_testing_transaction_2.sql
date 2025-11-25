alter table wallet.testing
  add constraint testing_even_description_required
  check (not is_even or even_description is not null);

create table wallet.testing_2 (
  "id" serial primary key,
  "created_at" timestamp with time zone not null default now(),
);