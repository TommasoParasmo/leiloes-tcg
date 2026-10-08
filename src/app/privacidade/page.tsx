import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Política de privacidade · Bate Carta" };

export default function PrivacidadePage() {
  return (
    <LegalPage title="Privacidade">
      <p>Esta política explica quais dados o Bate Carta guarda, para quê e o que você pode pedir, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).</p>

      <h2>Dados que guardamos</h2>
      <ul>
        <li>
          <b>Cadastro:</b> nome, apelido, e-mail, WhatsApp, CPF e endereço de entrega.
        </li>
        <li>
          <b>Leilões:</b> seus lances, arremates, lotes, pedidos, comprovantes de Pix e advertências.
        </li>
        <li>
          <b>Uso:</b> data do aceite destes termos e registros técnicos de acesso para segurança (por exemplo, o endereço IP ao limitar tentativas repetidas).
        </li>
      </ul>

      <h2>Para que usamos</h2>
      <ul>
        <li>Registrar lances e arremates e mostrar o resultado (o apelido é público).</li>
        <li>Cobrar por Pix, conferir comprovantes e calcular e enviar o frete.</li>
        <li>Avisar sobre arremates, prazos de pagamento e envio.</li>
        <li>Evitar fraude: uma conta por CPF e WhatsApp, e manter o bloqueio de quem não paga.</li>
      </ul>

      <h2>Com quem compartilhamos</h2>
      <ul>
        <li>Supabase, que guarda o banco de dados e as contas, e Vercel, que hospeda o site.</li>
        <li>ViaCEP, que recebe só o CEP digitado para preencher o endereço.</li>
        <li>A transportadora ou serviço de frete, que recebe nome e endereço para a etiqueta.</li>
        <li>O grupo do WhatsApp, que recebe só o apelido de quem arrematou, a carta e o valor.</li>
      </ul>
      <p>Não vendemos seus dados e não os usamos para publicidade.</p>

      <h2>Por quanto tempo</h2>
      <ul>
        <li>Enquanto a conta existir.</li>
        <li>Pedidos pagos e comprovantes ficam pelo prazo exigido pela lei fiscal, mesmo depois da exclusão da conta.</li>
        <li>CPF e WhatsApp de uma conta excluída ficam guardados para impedir que uma conta bloqueada volte com outro e-mail.</li>
      </ul>

      <h2>Seus direitos</h2>
      <p>
        Você pode ver e corrigir seus dados em <Link href="/conta">Conta</Link> e excluir a conta lá mesmo. Na exclusão, nome, apelido, e-mail, endereço e o texto dos
        avisos são apagados e você sai de todos os aparelhos. Para outros pedidos (cópia dos dados, dúvidas), fale com o leiloeiro pelo WhatsApp do grupo.
      </p>

      <h2>Segurança</h2>
      <p>
        O acesso é protegido por senha, cada pessoa só lê os próprios dados, e as regras do leilão (lances, prazos, bloqueios) rodam no servidor. Tentativas repetidas
        em sequência são limitadas.
      </p>
    </LegalPage>
  );
}
