(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};

    const FOCUSES = [
        { id: 'context-relationship', label: '上下文关系' },
        { id: 'space-time-relationship', label: '时空关系' },
        { id: 'character-relationship', label: '人物关系' },
    ];
    const DIRECTIONS = [
        { id: 'drama', label: '戏剧性' },
        { id: 'positive', label: '正向' },
        { id: 'negative', label: '负向' },
        { id: 'success', label: '成功倾向' },
        { id: 'romantic', label: '浪漫倾向' },
    ];

    function randomInt(min, max) {
        const low = Math.ceil(Number(min));
        const high = Math.floor(Number(max));
        const range = high - low + 1;
        if (range <= 1) return low;
        if (globalThis.crypto?.getRandomValues) {
            const limit = Math.floor(0x100000000 / range) * range;
            const values = new Uint32Array(1);
            do globalThis.crypto.getRandomValues(values); while (values[0] >= limit);
            return low + (values[0] % range);
        }
        return low + Math.floor(Math.random() * range);
    }
    function pick(items) { return items[randomInt(0, items.length - 1)]; }
    function outcome(number) {
        if (number === 1) return 'critical-failure';
        if (number === 20) return 'critical-success';
        return number <= 10 ? 'failure' : 'success';
    }
    function outcomeLabel(value) {
        return ({
            'critical-failure': '大失败', failure: '失败', success: '成功', 'critical-success': '大成功',
        })[value] || value;
    }
    function intensityLabel(number) {
        if (number <= 4) return '平静';
        if (number <= 8) return '低强度';
        if (number <= 12) return '中等';
        if (number <= 16) return '较高';
        if (number <= 19) return '强烈';
        return '高潮级';
    }
    function createRound(turnKey = '') {
        const focus = pick(FOCUSES);
        const direction = pick(DIRECTIONS);
        const poolSize = randomInt(1, 4);
        const checkPool = Array.from({ length: poolSize }, () => {
            const number = randomInt(1, 20);
            return { number, outcome: outcome(number) };
        });
        const intensity = randomInt(1, 20);
        return {
            version: 1,
            turnKey: String(turnKey || ''),
            intensity: { number: intensity, label: intensityLabel(intensity) },
            analysisFocus: focus,
            informationIsolation: true,
            direction: { id: direction.id, label: direction.label, number: randomInt(1, 20) },
            checkPool,
        };
    }
    function normalizeRound(value) {
        if (!value || typeof value !== 'object') return null;
        const pool = Array.isArray(value.checkPool) ? value.checkPool.map((item) => {
            const number = Math.min(20, Math.max(1, Number(item?.number || item) || 1));
            return { number, outcome: outcome(number) };
        }) : [];
        const intensityNumber = Math.min(20, Math.max(1, Number(value.intensity?.number) || 1));
        const directionNumber = Math.min(20, Math.max(1, Number(value.direction?.number) || 1));
        return {
            version: 1,
            turnKey: String(value.turnKey || ''),
            intensity: { number: intensityNumber, label: intensityLabel(intensityNumber) },
            analysisFocus: FOCUSES.find((item) => item.id === value.analysisFocus?.id) || FOCUSES[0],
            informationIsolation: true,
            direction: Object.assign({}, DIRECTIONS.find((item) => item.id === value.direction?.id) || DIRECTIONS[0], { number: directionNumber }),
            checkPool: pool,
        };
    }
    function plannerInstructions(roundValue) {
        const round = normalizeRound(roundValue);
        if (!round) return '';
        return `\n\n# 本轮骰子推进（程序预掷，必须遵守）

1. 剧情强度骰为 ${round.intensity.number}/20（${round.intensity.label}）。它只调整本轮变化幅度，不判定成败。低强度可以只有微小变化，高强度也必须有既存因果支撑。
2. 本轮优先分析“${round.analysisFocus.label}”，但不排除其他必要信息。此项只是随机焦点，不掷 d20。
3. 先检查信息隔离：分清各人物已知、未知、误信与信息来源。信息边界是事实检查，不掷骰。
4. 剧情方向为“${round.direction.label}”，方向骰 ${round.direction.number}/20。该数字表示这个方向的强度，不按成败规则解读；不得为迎合方向而违反人设、信息边界或因果。
5. 只有行动结果同时具备“不确定性、现实阻力、有意义的成败后果”时才需要行动检定。日常必然行为、无压力过渡、已成立事实、显而易见的信息、普通说话与一般情绪/思考不检定。只有抵抗强烈冲动、精神压力或敌对影响等结果不确定的思维行为才可检定。
6. 行动检定必须从骰池第一个数字开始顺序消耗，不得挑选、跳过、重掷或自造数字。骰池用完后，不再发起新检定，改用已有事实与最保守的合理结果。
7. 行动检定：1=大失败；2–10=失败；11–19=成功；20=大成功。数字 10 归入失败，避免阈值重叠。
8. 需要检定时，正文必须在相应行动附近插入：<check>[姓名|结果|数字|简短原因]</check>。结果只用 critical failure、failure、success 或 critical success；原因不超过30字。无需检定的行为不得输出 <check>。
9. 可用检定骰（必须按顺序）：${round.checkPool.map((item) => item.number).join(', ') || '无'}。
10. 遵守现有 <writing_style>。不输出思维链；在内部选择写作技巧。正文不使用“——”，并避免连续重复同一句式。`;
    }
    function injectionBlock(roundValue) {
        const round = normalizeRound(roundValue);
        if (!round) return '';
        const pool = round.checkPool.map((item) => `${item.number}（${outcomeLabel(item.outcome)}）`).join(' → ') || '无';
        return `[骰子推进｜优先执行]
剧情强度：${round.intensity.number}/20（${round.intensity.label}），只控制幅度，不判定成败。
分析焦点：${round.analysisFocus.label}（不掷骰）。
信息隔离：先核对各人物已知/未知/信息来源（不掷骰）。
剧情方向：${round.direction.label} ${round.direction.number}/20，数字表示方向强度，不判定成败。
仅当行动同时有不确定性、现实阻力和有意义后果时检定；日常必然行为、无压力过渡、显而易见的信息、普通说话和一般思考不检定。
检定骰池（按顺序且仅用一次）：${pool}。规则：1=大失败，2–10=失败，11–19=成功，20=大成功。
需要检定时在对应内容附近输出 <check>[姓名|结果|数字|不超过30字的原因]</check>；无需检定时不输出标签。
遵守 <writing_style>，不输出思维链；不使用“——”，避免连续重复同一句式。`;
    }

    WSM.Dice = { createRound, normalizeRound, plannerInstructions, injectionBlock, outcome, intensityLabel };
})();
