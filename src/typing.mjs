const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Presence is advisory: an unavailable typing endpoint must not block a reply.
export function createTyping({waha,refreshMs=7000,minimumMs=900,wait=sleep}) {
  return async function start(chatId) {
    const payload={session:'default',chatId};
    let closed=false,refreshing=false,shownAt=null,pending=Promise.resolve(),stopping;
    async function refresh() {
      if(closed||refreshing)return;
      refreshing=true;
      pending=(async()=>{
        try {
          await waha('/api/startTyping',payload,'POST',3000);
          shownAt??=performance.now();
        } catch {} finally {refreshing=false;}
      })();
      await pending;
    }
    await refresh();
    const timer=setInterval(()=>void refresh(),refreshMs);timer.unref?.();
    return {
      async beforeSend() {
        // Keep fast preset/error replies visible briefly, without slowing AI
        // responses which have already spent this time processing.
        if(shownAt!==null){const remaining=minimumMs-(performance.now()-shownAt);if(remaining>0)await wait(remaining);}
      },
      stop() {
        if(stopping)return stopping;
        closed=true;clearInterval(timer);
        stopping=(async()=>{
          // A late refresh must finish before stopTyping, never after it.
          await pending;
          try{await waha('/api/stopTyping',payload,'POST',3000);}catch{}
        })();
        return stopping;
      },
    };
  };
}
