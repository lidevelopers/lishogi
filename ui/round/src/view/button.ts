import { h } from 'snabbdom';
import { VNode } from 'snabbdom/vnode';
import { Hooks } from 'snabbdom/hooks';
import * as util from '../util';
import * as game from 'game';
import * as status from 'game/status';
import { game as gameRoute } from 'game/router';
import { PlayerUser } from 'game';
import { RoundData, MaybeVNodes } from '../interfaces';
import { ClockData } from '../clock/clockCtrl';
import RoundController from '../ctrl';
import { Shogi } from 'shogiops/shogi';
import { parseFen } from 'shogiops/fen';
import { SquareSet } from 'shogiops/squareSet';

function analysisBoardOrientation(data: RoundData) {
  return data.player.color;
}

function poolUrl(clock: ClockData, blocking?: PlayerUser) {
  return '/#pool/' + clock.initial / 60 + '+' + clock.increment + (blocking ? '/' + blocking.id : '');
}

function analysisButton(ctrl: RoundController): VNode | null {
  const d = ctrl.data,
    url = gameRoute(d, analysisBoardOrientation(d)) + '#' + ctrl.ply;
  return game.replayable(d)
    ? h(
        'a.fbt',
        {
          attrs: { href: url },
          hook: util.bind('click', _ => {
            // force page load in case the URL is the same
            if (location.pathname === url.split('#')[0]) location.reload();
          }),
        },
        ctrl.noarg('analysis')
      )
    : null;
}

function rematchButtons(ctrl: RoundController): MaybeVNodes {
  const d = ctrl.data,
    me = !!d.player.offeringRematch,
    them = !!d.opponent.offeringRematch,
    noarg = ctrl.noarg;
  return [
    them
      ? h(
          'button.rematch-decline',
          {
            attrs: {
              'data-icon': 'L',
              title: noarg('decline'),
            },
            hook: util.bind('click', () => {
              ctrl.socket.send('rematch-no');
            }),
          },
          ctrl.nvui ? noarg('decline') : ''
        )
      : null,
    h(
      'button.fbt.rematch.sente',
      {
        class: {
          me,
          glowing: them,
          disabled: !me && !(d.opponent.onGame || (!d.clock && d.player.user && d.opponent.user)),
        },
        attrs: {
          title: them ? noarg('yourOpponentWantsToPlayANewGameWithYou') : me ? noarg('rematchOfferSent') : '',
        },
        hook: util.bind(
          'click',
          e => {
            const d = ctrl.data;
            if (d.game.rematch) location.href = gameRoute(d.game.rematch, d.opponent.color);
            else if (d.player.offeringRematch) {
              d.player.offeringRematch = false;
              ctrl.socket.send('rematch-no');
            } else if (d.opponent.onGame) {
              d.player.offeringRematch = true;
              ctrl.socket.send('rematch-yes');
            } else if (!(e.target as HTMLElement).classList.contains('disabled')) ctrl.challengeRematch();
          },
          ctrl.redraw
        ),
      },
      [me ? util.spinner() : h('span', noarg('rematch'))]
    ),
  ];
}

export function standard(
  ctrl: RoundController,
  condition: ((d: RoundData) => boolean) | undefined,
  icon: string,
  hint: string,
  socketMsg: string,
  onclick?: () => void
): VNode {
  // disabled if condition callback is provided and is falsy
  const enabled = function () {
    return !condition || condition(ctrl.data);
  };
  return h(
    'button.fbt.' + socketMsg,
    {
      attrs: {
        disabled: !enabled(),
        title: ctrl.noarg(hint),
      },
      hook: util.bind('click', _ => {
        if (enabled()) onclick ? onclick() : ctrl.socket.sendLoading(socketMsg);
      }),
    },
    [h('span', ctrl.nvui ? [ctrl.noarg(hint)] : util.justIcon(icon))]
  );
}

export function impasse(ctrl: RoundController): VNode {
  return h(
    'button.fbt.impasse',
    {
      attrs: {
        title: ctrl.noarg('impasse'),
      },
      class: { active: ctrl.impasseHelp },
      hook: util.bind('click', _ => {
        ctrl.impasseHelp = !ctrl.impasseHelp;
        ctrl.redraw();
      }),
    },
    [h('span', ctrl.nvui ? [ctrl.noarg('impasse')] : util.justIcon('&'))]
  );
}

export function opponentGone(ctrl: RoundController) {
  const gone = ctrl.opponentGone();
  return gone === true
    ? h('div.suggestion', [
        h('p', { hook: onSuggestionHook }, ctrl.noarg('opponentLeftChoices')),
        h(
          'button.button',
          {
            hook: util.bind('click', () => ctrl.socket.sendLoading('resign-force')),
          },
          ctrl.noarg('forceResignation')
        ),
        h(
          'button.button',
          {
            hook: util.bind('click', () => ctrl.socket.sendLoading('draw-force')),
          },
          ctrl.noarg('forceDraw')
        ),
      ])
    : gone
    ? h('div.suggestion', [h('p', ctrl.trans.vdomPlural('opponentLeftCounter', gone, h('strong', '' + gone)))])
    : null;
}

function actConfirm(
  ctrl: RoundController,
  f: (v: boolean) => void,
  transKey: string,
  icon: string,
  klass?: string
): VNode {
  return h('div.act-confirm.' + transKey, [
    h('button.fbt.yes.' + (klass || ''), {
      attrs: { title: ctrl.noarg(transKey), 'data-icon': icon },
      hook: util.bind('click', () => f(true)),
    }),
    h('button.fbt.no', {
      attrs: { title: ctrl.noarg('cancel'), 'data-icon': 'L' },
      hook: util.bind('click', () => f(false)),
    }),
  ]);
}

export function resignConfirm(ctrl: RoundController): VNode {
  return actConfirm(ctrl, ctrl.resign, 'resign', 'b');
}

export function impasseHelp(ctrl: RoundController) {
  if (!ctrl.impasseHelp) return null;

  const lastStep = ctrl.data.steps[ctrl.data.steps.length - 1];
  const shogi = Shogi.fromSetup(parseFen(lastStep.fen).unwrap(), false).unwrap();

  const sentePromotion = SquareSet.promotionZone('sente').intersect(shogi.board.sente);
  const gotePromotion = SquareSet.promotionZone('gote').intersect(shogi.board.gote);
  const allMajorPieces = shogi.board.bishop.union(shogi.board.rook).union(shogi.board.horse).union(shogi.board.dragon);

  const senteKing: boolean = !sentePromotion.intersect(shogi.board.king).isEmpty();
  const goteKing: boolean = !gotePromotion.intersect(shogi.board.king).isEmpty();

  const senteNumberOfPieces: number = sentePromotion.diff(shogi.board.king).size();
  const goteNumberOfPieces: number = gotePromotion.diff(shogi.board.king).size();

  const senteImpasseValue =
    senteNumberOfPieces +
    allMajorPieces.intersect(sentePromotion).size() * 4 +
    shogi.pockets['sente'].count() +
    (shogi.pockets['sente'].bishop + shogi.pockets['sente'].rook) * 4;

  const goteImpasseValue =
    goteNumberOfPieces +
    allMajorPieces.intersect(gotePromotion).size() * 4 +
    shogi.pockets['gote'].count() +
    (shogi.pockets['gote'].bishop + shogi.pockets['gote'].rook) * 4;

  return h('div.suggestion', [
    h(
      'h5',
      {
        hook: onSuggestionHook,
      },
      [ctrl.noarg('impasse'), h('a.impasse-explanation', { attrs: { href: '/page/impasse', target: '_blank' } }, '?')]
    ),
    h('div.impasse', [
      h(
        'div.color-icon.sente',
        h('ul.impasse-list', [
          h('li', ['Entering king: ', senteKing ? '✓' : '✗']),
          h('li', ['Invading pieces: ', senteNumberOfPieces >= 10 ? '✓' : senteNumberOfPieces + '/10']),
          h('li', ['Total value: ', senteImpasseValue >= 28 ? '✓' : senteImpasseValue + '/28']),
        ])
      ),
      h(
        'div.color-icon.gote',
        h('ul.impasse-list', [
          h('li', ['Entering king: ', goteKing ? '✓' : '✗']),
          h('li', ['Invading pieces: ', goteNumberOfPieces >= 10 ? '✓' : goteNumberOfPieces + '/10']),
          h('li', ['Total value: ', goteImpasseValue >= 27 ? '✓' : goteImpasseValue + '/27']),
        ])
      ),
    ]),
  ]);
}

export function cancelTakebackProposition(ctrl: RoundController) {
  return ctrl.data.player.proposingTakeback
    ? h('div.pending', [
        h('p', ctrl.noarg('takebackPropositionSent')),
        h(
          'button.button',
          {
            hook: util.bind('click', () => ctrl.socket.sendLoading('takeback-no')),
          },
          ctrl.noarg('cancel')
        ),
      ])
    : null;
}

function acceptButton(ctrl: RoundController, klass: string, action: () => void, i18nKey: string = 'accept') {
  const text = ctrl.noarg(i18nKey);
  return ctrl.nvui
    ? h(
        'button.' + klass,
        {
          hook: util.bind('click', action),
        },
        text
      )
    : h('a.accept', {
        attrs: {
          'data-icon': 'E',
          title: text,
        },
        hook: util.bind('click', action),
      });
}
function declineButton(ctrl: RoundController, action: () => void, i18nKey: string = 'decline') {
  const text = ctrl.noarg(i18nKey);
  return ctrl.nvui
    ? h(
        'button',
        {
          hook: util.bind('click', action),
        },
        text
      )
    : h('a.decline', {
        attrs: {
          'data-icon': 'L',
          title: text,
        },
        hook: util.bind('click', action),
      });
}

export function answerOpponentTakebackProposition(ctrl: RoundController) {
  return ctrl.data.opponent.proposingTakeback
    ? h('div.negotiation.takeback', [
        h('p', ctrl.noarg('yourOpponentProposesATakeback')),
        acceptButton(ctrl, 'takeback-yes', ctrl.takebackYes),
        declineButton(ctrl, () => ctrl.socket.sendLoading('takeback-no')),
      ])
    : null;
}

export function submitMove(ctrl: RoundController): VNode | undefined {
  return ctrl.moveToSubmit || ctrl.dropToSubmit
    ? h('div.negotiation.move-confirm', [
        h('p', ctrl.noarg('confirmMove')),
        acceptButton(ctrl, 'confirm-yes', () => ctrl.submitMove(true)),
        declineButton(ctrl, () => ctrl.submitMove(false), 'cancel'),
      ])
    : undefined;
}

export function backToTournament(ctrl: RoundController): VNode | undefined {
  const d = ctrl.data;
  return d.tournament?.running
    ? h('div.follow-up', [
        h(
          'a.text.fbt.strong.glowing',
          {
            attrs: {
              'data-icon': 'G',
              href: '/tournament/' + d.tournament.id,
            },
            hook: util.bind('click', ctrl.setRedirecting),
          },
          ctrl.noarg('backToTournament')
        ),
        h(
          'form',
          {
            attrs: {
              method: 'post',
              action: '/tournament/' + d.tournament.id + '/withdraw',
            },
          },
          [h('button.text.fbt.weak', util.justIcon('Z'), 'Pause')]
        ),
        analysisButton(ctrl),
      ])
    : undefined;
}

export function backToSwiss(ctrl: RoundController): VNode | undefined {
  const d = ctrl.data;
  return d.swiss?.running
    ? h('div.follow-up', [
        h(
          'a.text.fbt.strong.glowing',
          {
            attrs: {
              'data-icon': 'G',
              href: '/swiss/' + d.swiss.id,
            },
            hook: util.bind('click', ctrl.setRedirecting),
          },
          ctrl.noarg('backToTournament')
        ),
        analysisButton(ctrl),
      ])
    : undefined;
}

export function moretime(ctrl: RoundController) {
  return game.moretimeable(ctrl.data)
    ? h('a.moretime', {
        attrs: {
          title: ctrl.data.clock ? ctrl.trans('giveNbSeconds', ctrl.data.clock.moretime) : ctrl.noarg('giveMoreTime'),
          'data-icon': 'O',
        },
        hook: util.bind('click', ctrl.socket.moreTime),
      })
    : null;
}

export function followUp(ctrl: RoundController): VNode {
  const d = ctrl.data,
    rematchable =
      !d.game.rematch &&
      (status.finished(d) || status.aborted(d)) &&
      !d.tournament &&
      !d.simul &&
      !d.swiss &&
      !d.game.boosted,
    newable = (status.finished(d) || status.aborted(d)) && (d.game.source === 'lobby' || d.game.source === 'pool'),
    rematchZone = ctrl.challengeRematched
      ? [
          h(
            'div.suggestion.text',
            {
              hook: onSuggestionHook,
            },
            ctrl.noarg('rematchOfferSent')
          ),
        ]
      : rematchable || d.game.rematch
      ? rematchButtons(ctrl)
      : [];
  return h('div.follow-up', [
    ...rematchZone,
    d.tournament
      ? h(
          'a.fbt',
          {
            attrs: { href: '/tournament/' + d.tournament.id },
          },
          ctrl.noarg('viewTournament')
        )
      : null,
    d.swiss
      ? h(
          'a.fbt',
          {
            attrs: { href: '/swiss/' + d.swiss.id },
          },
          ctrl.noarg('viewTournament')
        )
      : null,
    newable
      ? h(
          'a.fbt',
          {
            attrs: {
              href: d.game.source === 'pool' ? poolUrl(d.clock!, d.opponent.user) : '/?hook_like=' + d.game.id,
            },
          },
          ctrl.noarg('newOpponent')
        )
      : null,
    analysisButton(ctrl),
  ]);
}

export function watcherFollowUp(ctrl: RoundController): VNode | null {
  const d = ctrl.data,
    content = [
      d.game.rematch
        ? h(
            'a.fbt.text',
            {
              attrs: {
                'data-icon': 'v',
                href: `/${d.game.rematch}/${d.opponent.color}`,
              },
            },
            ctrl.noarg('viewRematch')
          )
        : null,
      d.tournament
        ? h(
            'a.fbt',
            {
              attrs: { href: '/tournament/' + d.tournament.id },
            },
            ctrl.noarg('viewTournament')
          )
        : null,
      d.swiss
        ? h(
            'a.fbt',
            {
              attrs: { href: '/swiss/' + d.swiss.id },
            },
            ctrl.noarg('viewTournament')
          )
        : null,
      analysisButton(ctrl),
    ];
  return content.find(x => !!x) ? h('div.follow-up', content) : null;
}

const onSuggestionHook: Hooks = util.onInsert(el => window.lishogi.pubsub.emit('round.suggestion', el.textContent));
