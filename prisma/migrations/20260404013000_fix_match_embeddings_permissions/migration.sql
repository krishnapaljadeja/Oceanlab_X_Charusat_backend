GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

ALTER FUNCTION public.match_embeddings(
  vector(768),
  int,
  text,
  text,
  text
) SECURITY DEFINER;

ALTER FUNCTION public.match_embeddings(
  vector(768),
  int,
  text,
  text,
  text
) SET search_path = public;

GRANT EXECUTE ON FUNCTION public.match_embeddings(
  vector(768),
  int,
  text,
  text,
  text
) TO anon, authenticated, service_role;
