(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};

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
    function createRound(turnKey = '') {
        const poolSize = randomInt(1, 3);
        const checkPool = Array.from({ length: poolSize }, (_, index) => {
            const number = randomInt(1, 20);
            return { index: index + 1, number, outcome: outcome(number) };
        });
        return {
            version: 2,
            turnKey: String(turnKey || ''),
            seed: randomInt(1, 100),
            shared: true,
            checkPool,
        };
    }
    function normalizeRound(value) {
        if (!value || typeof value !== 'object') return null;
        const pool = Array.isArray(value.checkPool) ? value.checkPool.slice(0, 3).map((item, index) => {
            const number = Math.min(20, Math.max(1, Number(item?.number || item) || 1));
            return { index: index + 1, number, outcome: outcome(number) };
        }) : [];
        return {
            version: 2,
            turnKey: String(value.turnKey || ''),
            seed: Math.min(100, Math.max(1, Number(value.seed) || Number(value.direction?.number) || 1)),
            shared: true,
            checkPool: pool,
        };
    }
    function plannerInstructions(roundValue) {
        const round = normalizeRound(roundValue);
        if (!round) return '';
        return `\n\n# 本轮共享骰池（程序预掷，可选随机源）

1. 骰子不决定剧情要不要推进，也不替代剧情推进模块；只有某件事已经允许发生、存在多个同样合理结果且没有唯一答案时，才用骰子选择结果倾向。
2. 可使用骰子的范围仅限：用户或NPC的不确定行动结果；满足基础条件后的可触发事件；NPC没有明确行程时的多个合理日程；条件允许的自然世界事件；世界进程本轮的顺利/轻微/停滞/受挫；长期线程具备发展条件后的方向或幅度。
3. 禁止直接掷骰改变人物关系、让角色随机获得知识、改写世界状态、生成时间线事实或决定因果影响是否成立。关系只能依据实际互动产生小幅反应；知识必须有来源；因果必须由前因和现实路径推出。
4. 已有明确安排、唯一物理结果、既定事实、能力边界、信息来源或完整因果链时不掷骰。骰子只能在合理范围内选结果，不能突破人设、能力、权限、距离、资源与世界规则。
5. 全部可用模块共享同一骰池，必须从第一枚开始顺序消耗；每枚最多使用一次，不得为每个模块另掷、挑选、跳过、重掷或自造数字。骰池用完后使用最保守的确定性推导。
6. 行动检定：1=大失败；2–10=失败；11–19=成功；20=大成功。世界进程等非行动事项按点数解释为受挫、停滞、轻微推进或顺利推进，但幅度必须服从已有条件。
7. 需要行动检定时，正文在对应行动附近插入：<check>[姓名|结果|数字|简短原因]</check>。结果只用 critical failure、failure、success 或 critical success；非行动模块不输出虚假的行动检定标签。
8. 共享随机种子为 ${round.seed}/100；可用骰池（按顺序且全模块共享）：${round.checkPool.map((item) => item.number).join(', ') || '无'}。
9. 不输出思维链，不得先决定结果再倒推骰义。`;
    }
    function injectionBlock(roundValue) {
        const round = normalizeRound(roundValue);
        if (!round) return '';
        const pool = round.checkPool.map((item) => `${item.number}（${outcomeLabel(item.outcome)}）`).join(' → ') || '无';
        return `[共享骰池｜可选随机源]
随机种子：${round.seed}/100。共享骰池：${pool}。
骰子不决定剧情是否推进；只有事项已具备发生条件、存在多个合理结果且没有唯一答案时才顺序消耗一枚。
可用：不确定行动结果、满足条件后的可触发事件、NPC多种合理日程、自然世界事件、世界进程推进幅度、已具备条件的长期线程方向。
禁用：人物关系升级、知识获得、世界状态、时间线、因果影响，以及已有明确行程、唯一结果或完整因果链的事项。
所有模块共享这一个池；不得各自掷骰，不得挑选、跳过、重掷或自造数字。骰池用完后按事实作最保守推导。
骰子只能在既定事实、人设、能力、权限、资源、距离、因果和世界规则允许的范围内解释。
行动检定规则：1=大失败，2–10=失败，11–19=成功，20=大成功；需要时输出 <check>[姓名|结果|数字|不超过30字原因]</check>。非行动模块不输出行动检定标签。
不得先决定结果再倒推骰义；不输出思维链。`;
    }

    WSM.Dice = { createRound, normalizeRound, plannerInstructions, injectionBlock, outcome };
})();
