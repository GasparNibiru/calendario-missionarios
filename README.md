# Calendário Missionários

Aplicação pronta para publicação no EasyPanel.

## O que já está incluído

- Calendário visível publicamente.
- Nomes e telefones visíveis para quem acessar o link.
- Senha exigida somente para cadastrar, agendar, editar, cancelar e gerar o próximo mês.
- Sessão administrativa de 30 minutos.
- PostgreSQL.
- Regra que impede dois almoços ou duas jantas no mesmo dia.
- Exclusão automática de agendamentos com mais de três meses.
- Botão do WhatsApp sem mensagem pronta.
- Dockerfile para EasyPanel.

## Variáveis de ambiente

Configure no EasyPanel:

```env
PORT=3000
DATABASE_URL=postgresql://USUARIO:SENHA@HOST:5432/NOME_DO_BANCO
ADMIN_PASSWORD=SUA_SENHA
JWT_SECRET=UMA_CHAVE_LONGA_E_ALEATORIA
COOKIE_SECURE=true
RETENTION_MONTHS=3
```

## Publicação

1. Envie estes arquivos para um repositório no GitHub.
2. No EasyPanel, crie um projeto.
3. Crie um serviço PostgreSQL.
4. Crie um serviço App conectado ao repositório.
5. Adicione as variáveis de ambiente.
6. Informe a porta 3000.
7. Faça o deploy.
8. Vincule o domínio ou subdomínio.

O backend cria as tabelas automaticamente na primeira inicialização.
