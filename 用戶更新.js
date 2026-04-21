// ═══════════════════════════════════════
// 用户动态状态同步脚本
// 监听 AI 回复结束事件，将最新变量同步到独立的「用户动态状态」条目
// 【重要】不会碰开场白创建的「用户信息」条目，二者独立共存
// ═══════════════════════════════════════

const ENTRY_NAME = '用户动态状态';
let lastContent = '';

/** 从 stat_data 构建动态状态内容（仅包含游玩中会变化的字段） */
function formatDynamicStatus(data) {
  const lines = ['<用户当前动态状态>'];
  lines.push('以下为主角最新的动态状态，与「用户信息」中的基础设定互补，以此处为准：');

  // 修为境界（最关键的动态数据）
  if (data.当前境界) lines.push(`当前修为: ${data.当前境界}`);

  // 修炼进度
  if (data.$修炼进度 > 0) lines.push(`修炼进度: ${data.$修炼进度}/100`);

  // 功法进度（可能在游玩中更换或精进层数）
  if (data.主修功法) {
    let gongfa = `主修功法: ${data.主修功法}`;
    if (data.功法品级) gongfa += ` (${data.功法品级})`;
    if (data.功法总层数 > 0) gongfa += ` [${data.功法已修层数}/${data.功法总层数}层]`;
    lines.push(gongfa);
  }

  if (data.习得术法) {
    const skills = data.习得术法;
    if (typeof skills === 'object' && skills !== null) {
      const skillStr = Object.entries(skills).map(([name, level]) => `${name}(${level})`).join('、');
      if (skillStr) lines.push(`已习术法: ${skillStr}`);
    } else if (typeof skills === 'string' && skills) {
      lines.push(`已习术法: ${skills}`);
    }
  }

  // 专精境界
  if (data.剑心境界) lines.push(`剑心境界: ${data.剑心境界}`);

  // 百艺境界（含丹道）
  const arts = [];
  if (data.丹道境界) arts.push(`炼丹(${data.丹道境界})`);
  if (data.炼器境界) arts.push(`炼器(${data.炼器境界})`);
  if (data.阵法境界) arts.push(`阵法(${data.阵法境界})`);
  if (data.符箓境界) arts.push(`符箓(${data.符箓境界})`);
  if (data.驭兽境界) arts.push(`驭兽(${data.驭兽境界})`);
  if (data.医术境界) arts.push(`医术(${data.医术境界})`);
  if (data.傀儡术境界) arts.push(`傀儡术(${data.傀儡术境界})`);
  if (data.种植采药境界) arts.push(`种植采药(${data.种植采药境界})`);
  if (arts.length > 0) lines.push(`修真百艺: ${arts.join('、')}`);

  // 道途（可能在游玩中转变）
  if (data.道途) lines.push(`当前道途: ${data.道途}`);

  // 所属势力与地位（可能变化）
  if (data.所属势力) lines.push(`所属势力: ${data.所属势力}`);
  if (data.宗门地位) lines.push(`宗门地位: ${data.宗门地位}`);

  // 装备（动态变化）
  if (data._装备_武器) lines.push(`当前武器: ${data._装备_武器}`);
  if (data._装备_防具) lines.push(`当前防具: ${data._装备_防具}`);
  if (data._装备_饰品) lines.push(`当前饰品: ${data._装备_饰品}`);
  if (data.装备_灵兽) lines.push(`灵宠: ${data.装备_灵兽}`);
  if (data.异火列表) lines.push(`异火: ${data.异火列表}`);

  // 位置（实时变化）
  const locParts = [data.大区域, data.子区域, data.具体地点].filter(Boolean);
  if (locParts.length > 0) lines.push(`当前位置: ${locParts.join(' - ')}`);

  // 寿元（动态消耗）
  if (data.当前寿元 > 0) {
    lines.push(`寿元: 年纪${data.当前年纪}岁 寿元${data.当前寿元} 剩余${data._剩余寿元} (${data._寿元状态})`);
  }

  // 心魔状态
  if (data.心魔状态 && data.心魔状态 !== '无') {
    let xinmo = `心魔状态: ${data.心魔状态}`;
    if (data.心魔名) xinmo += ` (${data.心魔名})`;
    if (data.心魔态度) xinmo += ` 态度:${data.心魔态度}`;
    lines.push(xinmo);
  }

  lines.push('</用户当前动态状态>');
  return lines.join('\n');
}

/** 同步动态状态到独立的世界书条目 */
async function syncDynamicStatus() {
  try {
    const latestId = getLastMessageId();
    if (latestId < 0) return;

    const variables = Mvu.getMvuData({ type: 'message', message_id: latestId });
    const statData = _.get(variables, 'stat_data');
    if (!statData || typeof statData !== 'object') return;

    // 至少有境界或灵根信息才同步
    if (!statData.当前境界 && !statData.灵根) return;

    const content = formatDynamicStatus(statData);

    // 内容无变化则跳过，避免触发 worldinfo_updated 重扫全部条目
    if (content === lastContent) {
      console.info('[动态状态同步] 内容无变化，跳过');
      return;
    }

    // 获取角色卡世界书名称
    const charWB = getCharWorldbookNames('current');
    const wbName = charWB.primary;
    if (!wbName) {
      console.warn('[动态状态同步] 未找到主世界书');
      return;
    }

    // 只删除「用户动态状态」条目，绝不碰「用户信息」
    await deleteWorldbookEntries(wbName, e => e.name === ENTRY_NAME);
    await createWorldbookEntries(wbName, [{
      name: ENTRY_NAME,
      enabled: true,
      strategy: {
        type: 'constant',
        keys: [],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
      position: {
        type: 'before_character_definition',
        role: 'system',
        depth: 0,
        order: 2, // 排在「用户信息」(order:1) 之后
      },
      content,
      probability: 100,
      recursion: {
        prevent_incoming: true,
        prevent_outgoing: true,
        delay_until: null,
      },
      effect: { sticky: null, cooldown: null, delay: null },
    }]);

    lastContent = content;
    console.info('[动态状态同步] 已更新「用户动态状态」条目');
  } catch (err) {
    console.error('[动态状态同步] 同步失败:', err);
  }
}

// ─── 防抖：避免频繁更新 ───
const debouncedSync = _.debounce(syncDynamicStatus, 2000);

$(() => {
  errorCatched(async () => {
    // 等待 MVU 初始化
    await waitGlobalInitialized('Mvu');
    console.info('[动态状态同步] MVU 已就绪，开始监听 AI 回复结束事件');

    // 只在 AI 回复结束后同步，避免频繁修改世界书导致提示词模板重读全部条目卡顿
    eventOn(tavern_events.GENERATION_ENDED, () => {
      console.info('[动态状态同步] AI 回复结束，触发同步');
      debouncedSync();
    });
  })();

  // 卸载时清理
  $(window).on('pagehide', () => {
    debouncedSync.cancel();
  });
});