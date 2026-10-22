-- pg_temp last: a temp table can never shadow a real one inside the definer function.
alter function admin_usage(int) set search_path = public, pg_temp;
