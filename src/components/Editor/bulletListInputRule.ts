import { Plugin, PluginKey } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

const bulletListInputRuleKey = new PluginKey("bullet-list-input-rule");

export const bulletListInputRulePlugin = $prose(() => {
    return new Plugin({
        key: bulletListInputRuleKey,
        props: {
            handleTextInput(view, from, to, text) {
                if (view.composing) return false;

                const state = view.state;
                const $from = state.doc.resolve(from);
                if ($from.parent.type.spec.code) return false;

                const textBefore = $from.parent.textBetween(
                    Math.max(0, $from.parentOffset - 500),
                    $from.parentOffset,
                    undefined,
                    "\ufffc"
                ) + text;

                const cleanedText = textBefore.replace(/\ufffc/g, "");

                const match = /^\s*([-+*])\s$/.exec(cleanedText);
                if (!match) return false;

                const bulletList = state.schema.nodes.bullet_list;
                if (!bulletList) return false;

                const deleteFrom = from - (match[0].length - text.length);
                const deleteTo = to;

                let tr = state.tr.delete(deleteFrom, deleteTo);
                const $start = tr.doc.resolve(deleteFrom);
                const range = $start.blockRange();

                if (!range) return false;

                const wrapping = findWrapping(range, bulletList, {});
                if (!wrapping) return false;

                tr.wrap(range, wrapping);

                let before = tr.doc.resolve(deleteFrom - 1).nodeBefore;
                if (before && before.type === bulletList && canJoin(tr.doc, deleteFrom - 1)) {
                    tr.join(deleteFrom - 1);
                }

                view.dispatch(tr);
                return true;
            },
        },
    });
});

function findWrapping(range: any, nodeType: any, attrs: any = null): any[] | null {
    const { parent, startIndex, endIndex } = range;

    let around = parent.contentMatchAt(startIndex).findWrapping(nodeType);
    if (!around) return null;

    let outer = around.length ? around[0] : nodeType;
    if (!parent.canReplaceWith(startIndex, endIndex, outer)) return null;

    return around.map((w: any) => ({ type: w.type, attrs: w.attrs || null })).concat({ type: nodeType, attrs });
}

function canJoin(doc: any, pos: number): boolean {
    if (pos === 0) return false;
    const nodeBefore = doc.nodeAt(pos);
    const nodeAfter = doc.nodeAt(pos + 1);
    if (!nodeBefore || !nodeAfter) return false;
    return nodeBefore.type === nodeAfter.type;
}
