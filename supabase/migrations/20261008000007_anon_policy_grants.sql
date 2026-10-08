-- Correção: visitantes (anon) não conseguiam ler o catálogo, porque as políticas de RLS
-- chamam app_is_admin()/app_admin_can_see_user() e o papel anon não podia executá-las.
-- As duas funções devolvem false para quem não está logado.
grant execute on function public.app_is_admin(uuid) to anon;
grant execute on function public.app_admin_can_see_user(uuid) to anon;
