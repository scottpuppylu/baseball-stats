// Coordinates are written only after the scorer explicitly selects and confirms a point.
(function(root) {
  'use strict';
  let dialog;
  root.editReviewLandingPoint=function(gameId,inningIndex,playIndex) {
    if(!isEditingReviewGame)return;
    const game=allGames.find(g=>g.id===gameId);
    if(!game)return;
    applyReviewFormToGame(game);
    const play=game.innings?.[inningIndex]?.plateAppearances?.[playIndex];
    if(!play)return;
    if(!dialog){dialog=document.createElement('dialog');dialog.id='reviewLandingPointModal';document.body.appendChild(dialog);}
    dialog.className='ui-review-point-dialog';
    dialog.innerHTML=`<h3 class="text-lg font-bold">記錄實際擊球落點</h3>
      <p class="text-sm text-slate-300">點選球場上的實際位置，再按「使用此落點」。守位選項獨立保留；回到覆盤後請按儲存。</p>
      <svg viewBox="0 0 400 400" tabindex="0" role="img" aria-label="落點選擇球場，可點選或使用方向鍵調整" class="ui-review-point-field">${FIELD_BASE_SVG}<g data-point></g></svg>
      <p data-point-status role="status" class="text-sm text-slate-300"></p>
      <div class="ui-review-point-actions"><button type="button" data-point-cancel>取消</button><button type="button" data-point-clear>清除此筆落點</button><button type="button" data-point-accept>使用此落點</button></div>`;
    let candidate=Number.isFinite(play.x)&&Number.isFinite(play.y)?{x:play.x,y:play.y}:null;
    const svg=dialog.querySelector('svg'),accept=dialog.querySelector('[data-point-accept]');
    const paint=()=>{
      dialog.querySelector('[data-point]').innerHTML=candidate?`<circle cx="${candidate.x*400}" cy="${candidate.y*400}" r="7" fill="#fbbf24" stroke="white" stroke-width="2"/>`:'';
      dialog.querySelector('[data-point-status]').textContent=candidate?'已選取落點，可再點選調整。':'尚未記錄座標；僅選守位不會產生落點。';
      accept.disabled=!candidate;
    };
    svg.onpointerdown=event=>{
      const matrix=svg.getScreenCTM();if(!matrix)return;
      const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
      const local=point.matrixTransform(matrix.inverse());
      candidate={x:Math.max(0,Math.min(1,local.x/400)),y:Math.max(0,Math.min(1,local.y/400))};paint();
    };
    svg.onkeydown=event=>{
      const delta={ArrowLeft:[-.0125,0],ArrowRight:[.0125,0],ArrowUp:[0,-.0125],ArrowDown:[0,.0125]}[event.key];
      if(!delta)return;event.preventDefault();candidate ||= {x:.5,y:.5};
      candidate={x:Math.max(0,Math.min(1,candidate.x+delta[0])),y:Math.max(0,Math.min(1,candidate.y+delta[1]))};paint();
    };
    const finish=()=>{dialog.close();renderSelectedGameReview(gameId);};
    accept.onclick=()=>{if(!candidate)return;play.x=candidate.x;play.y=candidate.y;finish();};
    dialog.querySelector('[data-point-clear]').onclick=()=>{delete play.x;delete play.y;finish();};
    dialog.querySelector('[data-point-cancel]').onclick=()=>dialog.close();
    paint();dialog.showModal();svg.focus();
  };
})(window);
