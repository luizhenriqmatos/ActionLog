import { ThemeToggle } from './ThemeToggle'
import '../site.css'

/**
 * Site público do ScoutHouse para clubes (artboard Main.dc.html do canvas).
 *
 * Rota separada do aplicativo: sem login, sem Supabase, sem localStorage de
 * dado de time. **Nenhum dado de atleta é renderizado aqui** — os painéis de
 * exemplo usam só número de camisa e posição, nunca nome, e vêm rotulados como
 * exemplo, como no canvas.
 *
 * Todo o texto vem do canvas. Onde o canvas deixou um campo entre colchetes
 * ([SEU WHATSAPP], [NOME]...), o colchete foi mantido de propósito: é conteúdo
 * que o dono precisa preencher, e inventar número ou depoimento seria pior do
 * que mostrar a lacuna.
 */

const SETORES = [
  { nome: 'Defesa', aparelho: 'Celular 1', linhas: [{ n: '2', pos: 'Lateral direito', v: '19', l: 'passes ✓' }, { n: '3', pos: 'Zagueiro', v: '7', l: 'desarmes' }, { n: '6', pos: 'Lateral esquerdo', v: '4', l: 'intercep.' }] },
  { nome: 'Meio', aparelho: 'Celular 2', linhas: [{ n: '8', pos: 'Meia central', v: '31', l: 'passes ✓' }, { n: '5', pos: 'Volante', v: '5', l: 'desarmes' }, { n: '10', pos: 'Meia ofensivo', v: '27', l: 'passes ✓' }] },
  { nome: 'Ataque', aparelho: 'Celular 3', linhas: [{ n: '9', pos: 'Atacante', v: '4', l: 'finaliz.' }, { n: '11', pos: 'Ponta esquerda', v: '3', l: 'finaliz.' }, { n: '7', pos: 'Ponta direita', v: '12', l: 'passes ✓' }] },
]

const NUMEROS = [
  { valor: '3', texto: 'celulares no mesmo jogo' },
  { valor: '11', texto: 'ações registradas por atleta' },
  { valor: '11', texto: 'critérios de avaliação' },
  { valor: '4', texto: 'categorias, do Sub-15 ao Sub-20' },
]

const MATRIZ = [
  { titulo: 'Sem equipamento', texto: 'Roda no navegador do celular ou do computador da comissão.' },
  { titulo: 'Sem internet no campo', texto: 'O registro fica no aparelho e é enviado quando a rede volta, sem duplicar.' },
  { titulo: 'Uma conta por pessoa', texto: 'Cada membro da comissão entra com o próprio acesso e é convidado para o clube.' },
  { titulo: 'Minutos automáticos', texto: 'O cronômetro e as substituições calculam o tempo em campo de cada atleta.' },
  { titulo: 'Quatro categorias', texto: 'Sub-15, Sub-16, Sub-17 e Sub-20, cada uma com elenco e calendário próprios.' },
  { titulo: 'Pais sem login', texto: 'A família recebe o relatório em PDF ou pelo WhatsApp.' },
  { titulo: 'Dados protegidos', texto: 'Os dados dos atletas são tratados com segurança, conforme a LGPD.' },
  { titulo: 'Carga e GPS', breve: true, texto: 'Próxima versão: ler os dados de sensores GPS que o clube tiver. Ainda em construção.' },
]

const PERGUNTAS = [
  { q: 'Precisa comprar equipamento?', a: 'Não. O ScoutHouse roda no navegador dos aparelhos que a comissão já tem.' },
  { q: 'E se a internet do campo falhar?', a: 'O registro continua no aparelho. Quando a rede volta, tudo é enviado sozinho.' },
  { q: 'Os pais precisam instalar alguma coisa?', a: 'Não. Eles recebem o relatório em PDF ou pelo WhatsApp que o clube já usa.' },
  { q: 'Quantas pessoas registram o mesmo jogo?', a: 'Até três observadores ao mesmo tempo, um por setor: defesa, meio e ataque.' },
  { q: 'Como funciona a contratação?', a: 'O ScoutHouse é um serviço. O clube contrata o acesso e usa enquanto o contrato estiver ativo. O software, a marca e a metodologia são do ScoutHouse, e os dados dos atletas são tratados com segurança, conforme a LGPD.' },
]

export function ClubSite() {
  return (
    <div className="club-site">
      <header className="cs-nav">
        <div className="cs-nav-inner">
          <a className="cs-brand" href="#topo">
            <span className="cs-brand-mark">S</span>
            <span className="cs-brand-name">ScoutHouse</span>
          </a>
          <nav className="cs-links" aria-label="Seções do site">
            <a href="#jogo">Jogo ao vivo</a>
            <a href="#atleta">Ficha do atleta</a>
            <a href="#pais">Pais</a>
            <a href="#semana">Calendário</a>
            <a href="#perguntas">Perguntas</a>
          </nav>
          <div className="cs-nav-actions">
            <ThemeToggle />
            <a className="cs-btn cs-btn-primary" href="#demo">Agendar demonstração</a>
          </div>
        </div>
      </header>

      <main id="topo">
        {/* HERO */}
        <section className="cs-hero">
          <div className="cs-hero-copy">
            <div className="cs-eyebrow">Software para clubes de base</div>
            <h1>O jogo vira dado. O dado vira evolução.</h1>
            <p className="cs-lead">
              Scout ao vivo, avaliações e relatórios para os pais no mesmo lugar. Sua comissão
              registra no celular e para de depender de papel e planilha.
            </p>
            <div className="cs-cta-row">
              <a className="cs-btn cs-btn-primary cs-btn-lg" href="#demo">Agendar demonstração</a>
              <a className="cs-btn cs-btn-ghost cs-btn-lg" href="#jogo">Ver como funciona</a>
            </div>
          </div>

          <figure className="cs-mock">
            <div className="cs-mock-panel">
              <div className="cs-mock-score">
                <span className="cs-live"><i />Ao vivo · 2º tempo</span>
                <strong className="cs-clock">27:14</strong>
                <span className="cs-score">Sub-15 <b>2 <span>×</span> 1</b> Visitante</span>
              </div>
              <div className="cs-mock-sectors">
                {SETORES.map((setor) => (
                  <div className="cs-mock-sector" key={setor.nome}>
                    <div className="cs-mock-sector-top">
                      <span>{setor.nome}</span>
                      <span className="cs-mono">{setor.aparelho}</span>
                    </div>
                    {setor.linhas.map((linha) => (
                      <div className="cs-mock-row" key={linha.n}>
                        <span className="cs-jersey">{linha.n}</span>
                        <span className="cs-mock-pos">{linha.pos}</span>
                        <span className="cs-mock-val"><strong>{linha.v}</strong>{linha.l}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <figcaption>Tela de exemplo do Jogo ao vivo. Cada coluna é o celular de um observador.</figcaption>
          </figure>
        </section>

        {/* PROVA */}
        <section className="cs-proof">
          <p className="cs-proof-line">
            Construído com uma comissão técnica de base e usado em jogo real em novembro de 2026.
          </p>
          <div className="cs-numbers">
            {NUMEROS.map((item) => (
              <div key={item.texto}>
                <strong>{item.valor}</strong>
                <span>{item.texto}</span>
              </div>
            ))}
          </div>
          <blockquote className="cs-quote">
            <p>“[FRASE DA COMISSÃO SOBRE O JOGO DE QUINTA]”</p>
            <footer><span>[NOME]</span> · [FUNÇÃO NA COMISSÃO]</footer>
          </blockquote>
        </section>

        <section className="cs-chapter">
          <h2>Do apito inicial ao relatório dos pais.</h2>
        </section>

        {/* CENAS */}
        <section className="cs-scene" id="jogo">
          <div className="cs-scene-copy">
            <div className="cs-eyebrow">Jogo ao vivo</div>
            <h3>Três observadores, um jogo, nenhum lance contado em dobro.</h3>
            <p>
              Cada observador cuida de um setor no próprio celular. O ScoutHouse junta tudo no
              mesmo jogo, calcula os minutos de cada atleta e continua registrando se a internet
              cair.
            </p>
          </div>
          <div className="cs-scene-art cs-phones">
            {SETORES.map((setor) => (
              <div className="cs-phone" key={setor.nome}>
                <div className="cs-phone-top">{setor.nome}</div>
                <div className="cs-clock cs-clock-sm">27:14</div>
                {setor.linhas.map((linha) => (
                  <div className="cs-phone-row" key={linha.n}>
                    <span>{linha.pos}</span>
                    <strong>{linha.v}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="cs-scene cs-scene-alt" id="atleta">
          <div className="cs-scene-copy">
            <div className="cs-eyebrow">Ficha do atleta</div>
            <h3>Cada atleta com história, não só com o último jogo.</h3>
            <p>
              Avalie de 1 a 5 em 11 critérios e veja a nota ao lado dos números do scout. O app
              avisa quando um atleta passa de 30 dias sem avaliação.
            </p>
          </div>
          <div className="cs-scene-art">
            <div className="cs-bars" role="img" aria-label="Exemplo de notas por área, de 1 a 5">
              {[['Técnica', 76], ['Leitura de jogo', 70], ['Físico', 70], ['Comportamento', 94]].map(([nome, pct]) => (
                <div className="cs-bar" key={String(nome)}>
                  <span>{nome}</span>
                  <div className="cs-bar-track"><div className="cs-bar-fill" style={{ width: `${pct}%` }} /></div>
                </div>
              ))}
            </div>
            <p className="cs-art-note">O traço marca a avaliação de agosto.</p>
          </div>
        </section>

        <section className="cs-scene" id="pais">
          <div className="cs-scene-copy">
            <div className="cs-eyebrow">Relatório para os pais</div>
            <h3>A família enxerga o que o treinador vê.</h3>
            <p>
              O relatório sai pronto da ficha do atleta, em PDF ou pelo WhatsApp que o clube já
              usa. Os pais não precisam de conta nem de aplicativo.
            </p>
          </div>
          <div className="cs-scene-art">
            <div className="cs-sheet">
              <div className="cs-sheet-top">Relatório de novembro · Sub-15</div>
              <strong className="cs-sheet-title">Rafael está evoluindo.</strong>
              <p><strong>Ponto forte.</strong> Dedicação nos treinos e disciplina, com nota máxima.</p>
              <p><strong>Melhorou.</strong> Passe e domínio de bola subiram desde a última avaliação.</p>
              <p><strong>Vamos trabalhar.</strong> Finalização e resistência nas próximas semanas.</p>
            </div>
          </div>
        </section>

        <section className="cs-scene cs-scene-alt" id="semana">
          <div className="cs-scene-copy">
            <div className="cs-eyebrow">Calendário da semana</div>
            <h3>A semana inteira aponta para o jogo.</h3>
            <p>
              Marque cada dia com uma etiqueta: MD é o dia do jogo, MD-1 é a véspera, e assim por
              diante. No dia certo, o Jogo ao vivo abre direto do calendário.
            </p>
          </div>
          <div className="cs-scene-art">
            <div className="cs-week" role="img" aria-label="Exemplo de semana com etiquetas de periodização">
              {[['Seg', 'MD-3'], ['Ter', 'MD-2'], ['Qua', 'MD-1'], ['Qui', 'MD'], ['Sex', 'Folga'], ['Sáb', 'MD-5'], ['Dom', 'Folga']].map(([dia, tag]) => (
                <div className={`cs-week-day ${tag === 'MD' ? 'is-md' : ''}`} key={String(dia)}>
                  <span>{dia}</span>
                  <b className="cs-mono">{tag}</b>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* MATRIZ */}
        <section className="cs-matrix">
          <div className="cs-matrix-head">
            <div className="cs-eyebrow">Pensado para o dia de jogo</div>
            <h3>Funciona com o que o clube já tem.</h3>
          </div>
          <div className="cs-matrix-grid">
            {MATRIZ.map((item) => (
              <div className="cs-matrix-card" key={item.titulo}>
                <div className="cs-matrix-title">
                  {item.titulo}
                  {item.breve && <span className="cs-soon">em breve</span>}
                </div>
                <p>{item.texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* PERGUNTAS */}
        <section className="cs-faq" id="perguntas">
          <h3>O que o clube pergunta antes de começar</h3>
          <div className="cs-faq-list">
            {PERGUNTAS.map((item) => (
              <div className="cs-faq-item" key={item.q}>
                <div className="cs-faq-q">{item.q}</div>
                <p>{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FECHAMENTO */}
        <section className="cs-closing" id="demo">
          <h2>Veja o ScoutHouse no seu próximo jogo</h2>
          <p className="cs-lead">
            Mostramos o sistema com a sua categoria e acompanhamos o primeiro jogo junto com a
            comissão.
          </p>
          <div className="cs-cta-row">
            <a className="cs-btn cs-btn-primary cs-btn-lg" href="#demo">Agendar demonstração</a>
            <span className="cs-contact">[SEU WHATSAPP]</span>
          </div>
          <figure className="cs-mock cs-mock-summary">
            <div
              className="cs-summary"
              role="img"
              aria-label="Resumo de jogo em destaque: 82% de precisão de passe, 37 bolas recuperadas e 5 de 11 finalizações no gol"
            >
              <div className="cs-summary-main">
                <span>Precisão de passe</span>
                <strong>82%</strong>
                <div className="cs-dots">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div>
              </div>
              <div className="cs-summary-side">
                <span>Bolas recuperadas</span><strong>37</strong>
                <span>Finalizações no gol</span><strong>5/11</strong>
              </div>
            </div>
            <figcaption>Números de exemplo de um resumo de jogo.</figcaption>
          </figure>
        </section>
      </main>

      <footer className="cs-footer">
        <div className="cs-footer-cols">
          <div>
            <div className="cs-footer-title">ScoutHouse</div>
            <p>Registro de ações e desempenho para o futebol de base. Feito em Salvador, Bahia.</p>
          </div>
          <div>
            <div className="cs-footer-title">Produto</div>
            <a href="#jogo">Jogo ao vivo</a>
            <a href="#atleta">Ficha do atleta</a>
            <a href="#pais">Relatório para os pais</a>
            <a href="#semana">Calendário</a>
          </div>
          <div>
            <div className="cs-footer-title">Contato</div>
            <a href="#demo">Agendar demonstração</a>
            <span className="cs-contact">[SEU WHATSAPP]</span>
            <span className="cs-contact">[SEU E-MAIL]</span>
          </div>
        </div>
        <div className="cs-wordmark" aria-hidden="true">ScoutHouse</div>
      </footer>
    </div>
  )
}
