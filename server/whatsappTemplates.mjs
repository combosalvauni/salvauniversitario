// server/whatsappTemplates.mjs
// ═══════════════════════════════════════════════════════════════
// Templates de mensagens WhatsApp para checkout
// Cada template recebe um objeto { customerName, offerName, amount, email, pixCode, pixUrl }
// e retorna a string formatada para envio via Baileys.
// ═══════════════════════════════════════════════════════════════

/**
 * Mensagem de pagamento aprovado — enviada quando o PIX/pagamento é confirmado.
 */
export function paymentApprovedMessage({ customerName, offerName, amount, email }) {
  const firstName = String(customerName || 'Cliente').split(' ')[0];
  const offer = String(offerName || 'Combo Salva Universitário');
  const value = String(amount || 'R$ 0,00');
  const userEmail = email ? `\n📧 *E-mail do acesso:* ${email}` : '';

  return [
    `✅ *Pagamento confirmado!*`,
    ``,
    `Olá, ${firstName}! Seu pagamento do *${offer}* no valor de *${value}* foi aprovado com sucesso.`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📦 *Pedido:* ${offer}`,
    `💰 *Valor:* ${value}${userEmail}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `🚀 *Próximos passos:*`,
    `1️⃣ Baixe o app ou acesse pelo navegador`,
    `2️⃣ Entre com o *mesmo e-mail da compra*`,
    `3️⃣ Seu acesso já está liberado automaticamente`,
    ``,
    `🔒 Sua compra tem *garantia de 30 dias*. Se não gostar, devolvemos seu dinheiro.`,
    ``,
    `Qualquer dúvida, é só responder esta mensagem! 💬`,
  ].join('\n');
}

/**
 * Mensagem de PIX gerado — enviada quando o checkout gera um PIX pendente.
 */
export function pixReadyMessage({ customerName, offerName, amount, pixCode }) {
  const firstName = String(customerName || 'Cliente').split(' ')[0];
  const offer = String(offerName || 'Combo Salva Universitário');
  const value = String(amount || 'R$ 0,00');

  const lines = [
    `⏳ *PIX pronto para pagamento!*`,
    ``,
    `Olá, ${firstName}! Seu pedido do *${offer}* no valor de *${value}* está quase finalizado.`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📦 *Pedido:* ${offer}`,
    `💰 *Valor:* ${value}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `📋 *Como pagar:*`,
    `1️⃣ Copie o código PIX abaixo`,
    `2️⃣ Abra o app do seu banco`,
    `3️⃣ Escolha *Pagar com PIX → Copia e Cola*`,
    `4️⃣ Cole o código e confirme`,
    ``,
  ];

  if (pixCode) {
    lines.push(`🔑 *Código PIX:*`);
    lines.push(`\`\`\`${pixCode}\`\`\``);
    lines.push(``);
  }

  lines.push(
    `⚡ Assim que o pagamento for confirmado, você receberá outra mensagem com as instruções de acesso.`,
    ``,
    `Qualquer dúvida, é só responder aqui! 💬`,
  );

  return lines.join('\n');
}

/**
 * Retorna todos os templates disponíveis com nome, descrição e variáveis.
 * Usado pelo painel admin para listar e previsualizar.
 */
export function listTemplates() {
  return [
    {
      id: 'payment_approved',
      name: 'Pagamento Aprovado',
      description: 'Enviada automaticamente quando o pagamento PIX ou cartão é confirmado.',
      variables: ['customerName', 'offerName', 'amount', 'email'],
      preview: paymentApprovedMessage({
        customerName: 'João',
        offerName: 'Combo Trimestral',
        amount: 'R$ 94,90',
        email: 'joao@email.com',
      }),
    },
    {
      id: 'pix_ready',
      name: 'PIX Pronto',
      description: 'Enviada quando o checkout gera o código PIX para pagamento.',
      variables: ['customerName', 'offerName', 'amount', 'pixCode'],
      preview: pixReadyMessage({
        customerName: 'João',
        offerName: 'Combo Trimestral',
        amount: 'R$ 94,90',
        pixCode: '00020126580014br.gov.bcb.pix0136exemplo-pix-code-aqui5204000053039865802BR5925COMBO SALVA UNIVERSITARI6009SAO PAULO',
      }),
    },
  ];
}
