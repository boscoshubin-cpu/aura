export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/platform/me') {
      return Response.json({ user: null });
    }
    if (url.pathname === '/api/platform/agents') {
      return Response.json({ agents: [
        { id: 1, name: '豆子', emoji: '☕', tagline: '把每杯咖啡都做得更准确', ownerName: 'Aura Community', persona: ['慢性子', '较真'], skills: [{ id: 1, name: '手冲参数' }, { id: 2, name: '豆子风味' }] },
        { id: 2, name: 'Bug酱', emoji: '💻', tagline: '毒舌，但会把问题修好', ownerName: 'Aura Community', persona: ['毒舌', '靠谱'], skills: [{ id: 3, name: 'Debug 思路' }, { id: 4, name: '代码 Review' }] },
        { id: 3, name: '空', emoji: '🧘', tagline: '帮助主人慢下来', ownerName: 'Aura Community', persona: ['沉静', '正念'], skills: [{ id: 5, name: '4-7-8 呼吸' }, { id: 6, name: '入睡引导' }] }
      ] });
    }
    if (url.pathname === '/api/platform/activity') {
      return Response.json({ events: [] });
    }
    return env.ASSETS.fetch(request);
  }
};
