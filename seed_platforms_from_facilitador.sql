-- Generated from facilitador.txt (bulk insert platforms)
-- Status mapping: maintenance -> inactive, active -> active

insert into public.platforms (name, description, image_url, status)
select * from (
values
  ('Aithor', 'Transforme sua escrita com nosso assistente de pesquisa com inteligência artificial', 'https://i.ibb.co/fVHPk0vV/aithor.png', 'active'),
  ('Alfacon', 'Os cursos preparatórios para concursos do AlfaCon são compostos por videoaulas e materiais de apoio em PDF', 'https://i.ibb.co/0jN3wnpD/ALFACON.png', 'active'),
  ('Alura Plus', 'Aprenda Programação, Front-end, Back-end, Data Science, UX, DevOps, Inovação e Gestão na maior plataforma de tecnologia do Brasil', 'https://i.ibb.co/whm9wV5g/images-2.png', 'active'),
  ('Amazon prime', 'O Amazon Prime Video é um serviço de streaming de vídeo que oferece um catálogo de filmes, séries, documentários e transmissões ao vivo', 'https://i.ibb.co/VWkG00M0/prime-video.png', 'active'),
  ('Brainly', 'O Brainly é uma comunidade de compartilhamento de conhecimento onde milhões de estudantes e especialistas unem forças para resolver as tarefas escolares', 'https://i.ibb.co/C5BcmMBm/brainly.png', 'active'),
  ('Caveira Ultimate', 'Os maiores especialistas em concursos policiais do Brasil agora serão seus professores no Caveira', 'https://i.ibb.co/sTnmSJW/caveira-concursos.png', 'active'),
  ('Chat-GPT 5', 'O GPT-5 é a versão mais recente e avançada do modelo de linguagem de inteligência artificial da OpenA', 'https://i.ibb.co/FqkW5LKQ/chatGPt.webp', 'active'),
  ('Claude', 'Claude é uma família de modelos de linguagem grandes (LLMs) e um chatbot de inteligência artificial (IA) generativa', 'https://i.ibb.co/RTxDW7yf/claude-1.png', 'active'),
  ('DeepL', 'O DeepL é uma plataforma de inteligência artificial (IA) linguística que oferece serviços de tradução automática e assistência de escrita', 'https://i.ibb.co/fVVDzKyX/DeepL.png', 'active'),
  ('Descomplica', 'Hoje, nosso negócio é focado em 5 categorias: Escolar, Vestibulares, Universidades, Concursos e Pós-graduação', 'https://i.ibb.co/DPkR7Zr0/images-1.png', 'active'),
  ('Direção Concursos', 'O Direção Concursos é uma empresa de educação especializada em cursos preparatórios para concursos públicos', 'https://i.ibb.co/C3dkLGSc/dire-o.png', 'active'),
  ('Disney +', 'Oferece filmes e séries de marcas como Disney, Pixar, Marvel, Star Wars e National Geographic, além de esportes ao vivo da ESPN', 'https://i.ibb.co/v2WprHK/disney.jpg', 'active'),
  ('DSO', 'Garanta a sua aprovação em concursos para Carreiras Policiais. Curso Online para Policial Civil, Federal, Militar, Penal e muito Mais!', 'https://i.ibb.co/bMZ9hZD4/DSO.jpg', 'active'),
  ('Estratégia Concursos', 'Estratégia Concursos Premium é referência na preparação de alunos para Concursos Públicos', 'https://i.ibb.co/3nD9RYF/1000x1000.jpg', 'active'),
  ('Estrategia Juridica', 'Cursos para Concursos Jurídicos completos e 100% digitais com foco na sua aprovação disponíveis sempre que quiser. Estude no seu tempo e em qualquer lugar', 'https://i.ibb.co/TBxLttx7/estrategia-juridica-1.png', 'active'),
  ('Estrategia OAB', 'A plataforma completa para a sua aprovação no Exame de Ordem', 'https://i.ibb.co/Hy9qDk1/Estrategia-Oab.png', 'active'),
  ('Focus', 'Cursos online para concursos públicos! Os cursos são compostos por videoaulas e materiais em PDF', 'https://i.ibb.co/4n3ySB96/focus.jpg', 'active'),
  ('Globo Pay', 'O Globoplay é a plataforma digital de streaming de vídeos e áudios sob demanda do Grupo Globo', 'https://i.ibb.co/pBbf9S2W/globo-pay.png', 'active'),
  ('Grammarly', 'O Grammarly torna a escrita com IA humanizada', 'https://i.ibb.co/VZrz6tw/grammarly.png', 'active'),
  ('Gran Cursos Online', 'Cursos preparatórios para concursos públicos com professores renomados', 'https://i.ibb.co/vKm7fg9/Avatar-Gran-Curso.jpg', 'active'),
  ('Netflix', 'A Netflix é um serviço de streaming por assinatura que oferece um vasto catálogo de filmes, séries, documentários e produções originais', 'https://i.ibb.co/ZzjbxcHK/netflix.png', 'active'),
  ('Passei Direto', 'Encontre materiais de estudo, videoaulas, resumos e exercícios resolvidos', 'https://i.ibb.co/39q79BGj/passei.png', 'inactive'),
  ('Perplexity', 'Perplexity gera respostas diretas, detalhadas e resumidas para as perguntas dos usuários, sempre citando as fontes de informação utilizadas', 'https://i.ibb.co/xSfB2SS7/perplexity.jpg', 'active'),
  ('Portal Concursos', 'Maior plataforma de concursos do Brasil! Aprenda a como passar no concursos do seus sonhos, acesse o site agora.', 'https://i.ibb.co/gZ99hjzz/portal.jpg', 'active'),
  ('Proenem', 'O Proenem é um cursinho online feito para quem quer arrasar no ENEM e nos vestibulares', 'https://i.ibb.co/PsbLqkrN/Proenem.jpg', 'active'),
  ('Qconcursos', 'Prepare-se para todos os concursos no Brasil! Estude questões de concursos e esteja mais preparado para o dia da prova com o Qconcursos!', 'https://i.ibb.co/YBbGsKRt/qconcursos.png', 'inactive'),
  ('Responda Aí', 'Estude mais rápido. Guia com resumos, provas antigas e exercícios resolvidos passo a passo, focados na prova da sua faculdade.', 'https://i.ibb.co/67rBtX5N/respondaai.webp', 'active'),
  ('Tec Concursos', 'Seja aprovado e mude de vida. Prepare-se com a ferramenta preferida dos aprovados nos concursos e exames mais concorridos do País', 'https://i.ibb.co/rGJRFHJz/Tec-Concursos-2.jpg', 'active')
) as v(name, description, image_url, status)
where not exists (
  select 1 from public.platforms p where p.name = v.name
);
