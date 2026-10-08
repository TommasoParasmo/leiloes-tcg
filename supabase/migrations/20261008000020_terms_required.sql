-- Exige o aceite dos termos no cadastro (função em 20261008000019).
-- Aplicar só depois do deploy do formulário com a caixa de aceite: o formulário
-- antigo não manda terms_version e o cadastro falharia.
create or replace trigger on_auth_user_terms
after insert on auth.users
for each row execute function public.app_record_terms();
