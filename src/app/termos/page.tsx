import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Termos de uso · Bate Carta" };

export default function TermosPage() {
  return (
    <LegalPage title="Termos de uso">
      <h2>O que é o Bate Carta</h2>
      <p>
        O Bate Carta é o site dos leilões de cartas colecionáveis (TCG) feitos ao vivo pelo leiloeiro. Aqui você acompanha a rodada, dá lances, arremata, junta seus
        arremates em um lote e paga por Pix.
      </p>

      <h2>Conta</h2>
      <ul>
        <li>Uma conta por pessoa. O WhatsApp e o CPF não se repetem entre contas.</li>
        <li>O CPF é pedido antes do primeiro lance.</li>
        <li>Seu apelido aparece para todos nos lances, nos resultados e no grupo do WhatsApp. Não use seu nome completo nem algo ofensivo.</li>
        <li>Você é responsável pelo acesso à sua conta. Não compartilhe a senha.</li>
      </ul>

      <h2>Lances e arremates</h2>
      <ul>
        <li>O resultado vale pelo que o servidor registrou, não pelo que aparece na sua tela. Em caso de empate no valor, vence quem lançou primeiro.</li>
        <li>No modo de maior lance, um lance que assume a liderança nos últimos 5 segundos acrescenta 10 segundos ao cronômetro.</li>
        <li>No modo rapidez, a carta fica com quem tocar em Arrematar primeiro.</li>
        <li>Todo lance e todo arremate é um compromisso de compra. Não há desistência depois de arrematar.</li>
        <li>O leiloeiro pode pausar, estender ou cancelar uma rodada; uma rodada cancelada não gera venda.</li>
      </ul>

      <h2>Lote, pagamento e prazo</h2>
      <ul>
        <li>Os arremates de até 2 leilões seguidos ficam guardados no mesmo lote.</li>
        <li>Quando o lote fecha, o pedido mostra o valor das cartas e do frete, e você paga por Pix e envia o comprovante pelo site.</li>
        <li>O prazo do Pix é de 7 dias após o fim do leilão. Se o lote juntou 2 leilões, o prazo é de 24 horas após o fim do segundo.</li>
        <li>O pagamento é confirmado manualmente pelo leiloeiro depois de conferir o Pix.</li>
      </ul>

      <h2>Cartões amarelos e bloqueio</h2>
      <ul>
        <li>Perder o prazo de pagamento gera um cartão amarelo.</li>
        <li>Com 2 cartões amarelos a conta fica bloqueada para novos lances. Só o leiloeiro desbloqueia, registrando o motivo.</li>
      </ul>

      <h2>Envio</h2>
      <p>
        As cartas são enviadas para o endereço da sua conta. O código de rastreio aparece no pedido e nos avisos. Confira o endereço antes de fechar o lote.
      </p>

      <h2>Excluir a conta</h2>
      <p>
        Você pode excluir a conta em <Link href="/conta">Conta</Link>, desde que não tenha cartas guardadas nem pedido em andamento. Veja na{" "}
        <Link href="/privacidade">política de privacidade</Link> o que é apagado e o que fica guardado.
      </p>

      <h2>Contato</h2>
      <p>Dúvidas sobre lances, pagamentos ou envio: fale com o leiloeiro pelo WhatsApp do grupo.</p>
    </LegalPage>
  );
}
