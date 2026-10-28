// Presentation cache and cooperative chart scheduling. Never reads or writes team-data storage.
(function(root) {
  'use strict';
  let revision=0,pumping=null,dataSignature=null;
  const pages=new Map(),panels=new WeakMap(),pending=new Map(),work=[];
  const stats={pageBuilds:0,chartCreates:0,chartUpdates:0};
  const avatars=new Map();let avatarRevision=0;
  function avatarVersion(values){
    let changed=avatars.size!==Object.keys(values).length;
    for(const [key,value]of Object.entries(values))if(avatars.get(key)!==value){avatars.set(key,value);changed=true;}
    for(const key of avatars.keys())if(!Object.hasOwn(values,key)){avatars.delete(key);changed=true;}
    if(changed)avatarRevision++;return avatarRevision;
  }
  const yieldTask=()=>root.scheduler?.yield?.()||new Promise(resolve=>setTimeout(resolve,0));
  const paint=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  function invalidate(){revision++;for(const job of pending.values())cancel(job);work.length=0;}
  function syncData(signature){if(signature!==dataSignature){dataSignature=signature;invalidate();}}
  function run(key,signature,render) {
    const read=typeof signature==='function'?signature:()=>signature;
    const stamp=revision+'|'+read();
    if(pages.get(key)===stamp)return false;
    render();pages.set(key,revision+'|'+read());stats.pageBuilds++;return true;
  }
  function cachedPanel(panel,active,render) {
    let entry=panels.get(panel);
    if(!active){
      if(panel.firstChild){entry ||= {revision:-1,fragment:document.createDocumentFragment()};while(panel.firstChild)entry.fragment.appendChild(panel.firstChild);panels.set(panel,entry);}
      return;
    }
    if(entry?.revision===revision){if(entry.fragment.firstChild)panel.appendChild(entry.fragment);return;}
    panel.replaceChildren();render(panel);
    stats.pageBuilds++;
    panels.set(panel,{revision,fragment:document.createDocumentFragment()});
  }
  function cancel(job){job.cancelled=true;job.observer?.disconnect();job.cleanup?.();if(pending.get(job.canvas)===job)pending.delete(job.canvas);}
  function create(previous,canvas,config) {
    if(previous&&previous.canvas===canvas&&previous.config.type===config.type){
      previous.stop();previous.setActiveElements([]);previous.tooltip?.setActiveElements([],{x:0,y:0});
      previous.data=config.data;previous.options=config.options||{};previous.update('none');stats.chartUpdates++;return previous;
    }
    previous?.destroy();stats.chartCreates++;return new Chart(canvas,config);
  }
  function pump() {
    if(pumping)return;
    pumping=(async()=>{
      while(work.length){
        await paint();await yieldTask();
        if(document.documentElement.hasAttribute('data-fl-scrolling')){await new Promise(resolve=>setTimeout(resolve,32));continue;}
        const job=work.shift();if(job.cancelled)continue;
        if(!job.canvas.isConnected){cancel(job);continue;}
        if(job.canvas.closest('[id^="panel"]')?.classList.contains('hidden')){job.queued=false;job.observer?.observe(job.canvas);continue;}
        cancel(job);job.draw();
      }
    })().catch(error=>console.error('[chart-render]',error)).finally(()=>{pumping=null;if(work.length)pump();});
  }
  function chart(previous,target,config,assign) {
    const canvas=typeof target==='string'?document.getElementById(target):target?.canvas||target;
    if(!canvas)return null;
    if(pending.has(canvas))cancel(pending.get(canvas));
    config.options={...config.options,maintainAspectRatio:false};
    if(root.matchMedia('(pointer: coarse)').matches)config.options.animation=false;
    canvas.parentElement?.classList.add('ui-chart-frame');
    canvas.closest('section')?.classList.add('ui-render-section');
    if(!root.__deferPageCharts||!root.IntersectionObserver)return create(previous,canvas,config);
    if(previous&&(previous.canvas!==canvas||previous.config.type!==config.type)){previous.destroy();previous=null;}
    canvas.setAttribute('aria-busy','true');canvas.parentElement?.classList.add('ui-chart-pending');
    const job={previous,canvas,config,assign,cancelled:false,queued:false,draw:()=>assign(create(previous,canvas,config)),cleanup:()=>{canvas.removeAttribute('aria-busy');canvas.parentElement?.classList.remove('ui-chart-pending');}};
    pending.set(canvas,job);
    job.observer=new IntersectionObserver(entries=>{
      if(job.cancelled||job.queued||!entries.some(entry=>entry.isIntersecting))return;
      job.queued=true;job.observer.disconnect();work.push(job);pump();
    },{rootMargin:'240px'});
    job.observer.observe(canvas);
    return previous;
  }
  function defer(element,render) {
    if(!element||!root.__deferPageCharts||!root.IntersectionObserver){render();return;}
    element.closest('section')?.classList.add('ui-render-section');
    if(pending.has(element))cancel(pending.get(element));
    const job={canvas:element,cancelled:false,queued:false,draw:render};pending.set(element,job);
    job.observer=new IntersectionObserver(entries=>{
      if(job.cancelled||job.queued||!entries.some(entry=>entry.isIntersecting))return;
      job.queued=true;job.observer.disconnect();work.push(job);pump();
    },{rootMargin:'240px'});job.observer.observe(element);
  }
  root.PageRendering={invalidate,syncData,avatarVersion,run,cachedPanel,chart,defer,stats,
    async settled(){await paint();await paint();while(pumping)await pumping;},
    revision:()=>revision};
})(window);
