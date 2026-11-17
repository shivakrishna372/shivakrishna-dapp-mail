-- DAPP Mail — Step 6: let the server functions (service role) read and write the mail tables.
-- This project does not grant table access to service_role automatically.
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
