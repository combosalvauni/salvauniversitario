-- Limpeza global de dados legados relacionados a "Salva Universitario"
-- Execute no Supabase SQL Editor

begin;

-- 1) Atualiza defaults para evitar reincidência
alter table if exists public.support_settings
  alter column email_value set default 'contato@concursaflix.com';

alter table if exists public.support_settings
  alter column email_url set default 'mailto:contato@concursaflix.com';

-- 2) Corrige linha singleton de suporte (se existir)
update public.support_settings
set
  email_value = regexp_replace(
    regexp_replace(coalesce(email_value, ''), '(?i)combosalvauniversitario', 'concursaflix', 'g'),
    '(?i)salva\s*universit[áa]rio(s)?',
    'ConcursaFlix',
    'g'
  ),
  email_url = regexp_replace(
    regexp_replace(coalesce(email_url, ''), '(?i)combosalvauniversitario', 'concursaflix', 'g'),
    '(?i)salva\s*universit[áa]rio(s)?',
    'ConcursaFlix',
    'g'
  )
where
  coalesce(email_value, '') ~* 'combosalvauniversitario|salva\s*universit[áa]rio'
  or coalesce(email_url, '') ~* 'combosalvauniversitario|salva\s*universit[áa]rio';

-- 3) Limpeza global em todas as colunas text/varchar/json/jsonb do schema public
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying', 'json', 'jsonb')
  LOOP
    IF rec.data_type IN ('text', 'character varying') THEN
      EXECUTE format(
        'update %I.%I
         set %I = regexp_replace(
           regexp_replace(%I, ''(?i)combosalvauniversitario'', ''concursaflix'', ''g''),
           ''(?i)salva\\s*universit[áa]rio(s)?'',
           ''ConcursaFlix'',
           ''g''
         )
         where %I ~* ''combosalvauniversitario|salva\\s*universit[áa]rio'';',
        rec.table_schema,
        rec.table_name,
        rec.column_name,
        rec.column_name,
        rec.column_name
      );
    ELSE
      EXECUTE format(
        'update %I.%I
         set %I = regexp_replace(
           regexp_replace(%I::text, ''(?i)combosalvauniversitario'', ''concursaflix'', ''g''),
           ''(?i)salva\\s*universit[áa]rio(s)?'',
           ''ConcursaFlix'',
           ''g''
         )::%s
         where %I::text ~* ''combosalvauniversitario|salva\\s*universit[áa]rio'';',
        rec.table_schema,
        rec.table_name,
        rec.column_name,
        rec.column_name,
        rec.data_type,
        rec.column_name
      );
    END IF;
  END LOOP;
END
$$;

commit;

-- 4) Verificação (deve retornar apenas notices de "OK" ou contagens zeradas)
DO $$
DECLARE
  rec RECORD;
  v_count bigint;
  v_total bigint := 0;
BEGIN
  FOR rec IN
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying', 'json', 'jsonb')
  LOOP
    IF rec.data_type IN ('text', 'character varying') THEN
      EXECUTE format(
        'select count(*) from %I.%I where %I ~* ''combosalvauniversitario|salva\\s*universit[áa]rio'';',
        rec.table_schema,
        rec.table_name,
        rec.column_name
      ) INTO v_count;
    ELSE
      EXECUTE format(
        'select count(*) from %I.%I where %I::text ~* ''combosalvauniversitario|salva\\s*universit[áa]rio'';',
        rec.table_schema,
        rec.table_name,
        rec.column_name
      ) INTO v_count;
    END IF;

    IF v_count > 0 THEN
      v_total := v_total + v_count;
      RAISE NOTICE 'Pendência: %.%.% -> % linha(s)', rec.table_schema, rec.table_name, rec.column_name, v_count;
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    RAISE NOTICE 'OK: nenhuma referência legada encontrada no schema public.';
  ELSE
    RAISE WARNING 'Ainda existem % ocorrência(s) legada(s).', v_total;
  END IF;
END
$$;
