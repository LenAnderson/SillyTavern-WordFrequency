import { chat, chat_metadata, eventSource, event_types, getCurrentChatId, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { registerSlashCommand } from '../../../slash-commands.js';
import { isTrueBoolean } from '../../../utils.js';
import { Chart, registerables } from './lib/chartjs/chart.esm.js';

Chart.register(...registerables);

let isActive = false;
let consecutive = extension_settings.wordFrequency?.consecutive ?? [1,2,3];
let movingAverage = extension_settings.wordFrequency?.movingAverage ?? 10;
/**@type {HTMLElement} */
let dom;
let domChartContainer;
let domList;
let allWords;
let words;
const colors = [
    'silver',
    'red',
    'green',
    'magenta',
    'yellow',
    'orange',
    'blue',
    'purple',
    'black',
];
let selected = [];
const show = ()=>{
    dom?.remove();
    dom = document.createElement('div'); {
        dom.id = 'stwf--root';
        dom.classList.add('draggable');
        const chartContainer = document.createElement('div'); {
            domChartContainer = chartContainer;
            chartContainer.classList.add('stwf--chart');
            dom.append(chartContainer);
        }
        const list = document.createElement('div'); {
            domList = list;
            list.classList.add('stwf--list');
            dom.append(list);
        }
        document.body.append(dom);
    }
    isActive = true;
    update();
};
const hide = ()=>{
    isActive = false;
    dom?.remove();
};
const getWords = ()=>{
    const allText = chat.map(it=>it.mes.split('```').filter((_,idx)=>idx % 2 == 0).join('')).join('\n');
    const sentenceSegmenter = new Intl.Segmenter('en', { granularity:'sentence' });
    const wordSegmenter = new Intl.Segmenter('en', { granularity:'word' });
    const allSentences = Array.from(sentenceSegmenter.segment(allText)).map(it=>it.segment);
    allWords = [];
    for (const s of allSentences) {
        const words = Array.from(wordSegmenter.segment(s))
            .map(it=>it.segment.trim().toLowerCase())
            .filter(it=>it.length != 0 && !(it.length == 1 && !/[a-z]/i.test(it)))
        ;
        for (const num of consecutive) {
            if (num == 1) allWords.push(...words.map(it=>it.replace(/'s$/,'')));
            else {
                for (let i = 0; i + num <= words.length; i++) {
                    allWords.push(words.slice(i, i + num).join(' '));
                }
            }
        }
    }
    return allWords;
};
const processWords = (allWords)=>{
    allWords = allWords.filter(it=>!chat_metadata.wordFrequency.common.includes(it));
    let dict = {};
    for (let w of allWords) {
        if (!dict[w]) dict[w] = 0;
        dict[w]++;
    }
    words = Object.keys(dict).map(w=>({ word:w, count:dict[w] }));
    words.sort((a,b)=>b.count - a.count);
    words = words.filter(it=>it.word.length >= 3);
    words = words.slice(0, 100);
    return words;
};
const render = (words)=>{
    domList.innerHTML = '';
    let max;
    for (const word of words) {
        if (!max) max = word.count;
        const item = document.createElement('div'); {
            item.classList.add('stwf--item');
            item.title = 'Click to show/hide frequency over time.\nRight-click to remove from list.';
            item.textContent = `${word.word} (${word.count})`;
            item.style.background = `linear-gradient(90deg, var(--SmartThemeBotMesBlurTintColor) 0%, var(--SmartThemeBotMesBlurTintColor) ${word.count / max * 100}%, transparent ${word.count / max * 100}%, transparent 100%)`;
            item.addEventListener('contextmenu', (evt)=>{
                evt.preventDefault();
                if (chat_metadata.wordFrequency.common.includes(word.word)) {
                    chat_metadata.wordFrequency.common.splice(chat_metadata.wordFrequency.common.indexOf(word.word), 1);
                } else {
                    chat_metadata.wordFrequency.common.push(word.word);
                }
                saveMetadataDebounced();
                render(processWords(allWords));
            });
            item.addEventListener('click', ()=>{
                //TODO add to chart
                if (selected.includes(word.word)) {
                    selected.splice(selected.indexOf(word.word), 1);
                    item.classList.remove('stwf--selected');
                } else {
                    selected.push(word.word);
                    item.classList.add('stwf--selected');
                }
                updateChart();
            });
            domList.append(item);
        }
    }
};
const updateChart = ()=>{
    domChartContainer.innerHTML = '';
    if (selected.length > 0) {
        const canvas = document.createElement('canvas');
        canvas.classList.add('stwf--chartCanvas');
        domChartContainer.append(canvas);
        const dataSets = [];
        for (const word of selected) {
            const data = [];
            // let cum = 0;
            for (let idx = movingAverage; idx < chat.length; idx++) {
                // const mes = chat[idx];
                const cum = chat
                    .slice(movingAverage ? idx - movingAverage : 0, idx)
                    .map(it=>it.mes.toLowerCase().split(word).length - 1)
                    .reduce((sum,cur)=>sum + cur,0)
                ;
                // const count = mes.mes.toLowerCase().split(word).length - 1;
                // cum += count;
                data.push(cum / (movingAverage || idx));
            }
            chat.forEach((mes,idx)=>{
            });
            dataSets.push({
                label: word,
                data,
                fill: false,
                borderColor: colors[dataSets.length % colors.length],
            });
        }
        const chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: chat.map((it,idx)=>idx).filter(it=>it >= movingAverage),
                datasets: dataSets,
            },
            options: {
                scales: {
                    x: {
                        text: 'Message #',
                    },
                    y: {
                        text: 'Frequency per message',
                    },
                },
            },
        });
    }
};
const update = ()=>{
    if (!isActive) return;
    if (getCurrentChatId() === undefined) return hide();
    if (!chat_metadata.wordFrequency) {
        chat_metadata.wordFrequency = { common:[] };
        saveMetadataDebounced();
    }
    const allWords = getWords();
    const words = processWords(allWords);
    render(words);
    updateChart();
};

// show();
eventSource.on(event_types.USER_MESSAGE_RENDERED, ()=>update());
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, ()=>update());
eventSource.on(event_types.CHAT_CHANGED, ()=>update());
eventSource.on(event_types.MESSAGE_EDITED, ()=>update());

registerSlashCommand('wordfrequency',
    (args, value)=>{
        if (isActive) hide();
        else show();
    },
    [],
    '<span class="monospace"></span> – Show / hide word frequency panel.',
    true,
    true,
);
registerSlashCommand('wordfrequency-consecutive',
    (args, value)=>{
        if (value?.trim()) {
            const list = JSON.parse(value);
            if (!extension_settings.wordFrequency) extension_settings.wordFrequency = {};
            extension_settings.wordFrequency.consecutive = list;
            consecutive = extension_settings.wordFrequency.consecutive;
            saveSettingsDebounced();
            update();
        } else {
            return JSON.stringify(consecutive);
        }
    },
    [],
    '<span class="monospace">(listOfNumbers)</span> – Set number of consecutive words to check. Example: <code>/wordfrequency-consecutive [1,2,3]</code> to check individual words as well as one-word and two-word sequences.',
    true,
    true,
);
registerSlashCommand('wordfrequency-movingaverage',
    (args, value)=>{
        if (value?.trim()) {
            if (!extension_settings.wordFrequency) extension_settings.wordFrequency = {};
            extension_settings.wordFrequency.movingAverage = Number(value.trim());
            movingAverage = extension_settings.wordFrequency.movingAverage;
            saveSettingsDebounced();
            updateChart();
        } else {
            return JSON.stringify(movingAverage);
        }
    },
    [],
    '<span class="monospace">(listOfNumbers)</span> – Set range of the moving average for the frequency chart. Set to <code>0</code> to disable moving average. Call without value to return the current setting.',
    true,
    true,
);

registerSlashCommand('wordfrequency-common',
    (args, value)=>{
        if (isTrueBoolean(args.clear)) {
            if (value?.trim()) {
                if (chat_metadata.wordFrequency.common.includes(value.trim())) {
                    chat_metadata.wordFrequency.common.splice(chat_metadata.wordFrequency.common.indexOf(value.trim()), 1);
                }
            } else {
                chat_metadata.wordFrequency.common = [];
            }
            saveMetadataDebounced();
            update();
        } else {
            return JSON.stringify(chat_metadata.wordFrequency.common);
        }
    },
    [],
    '<span class="monospace">[optional clear=true] (optional word)</span> – Show blocklist. Use <code>clear=true</code> to remove all "common" words / sequences, or a single common word / sequence from the blocklist.',
    true,
    true,
);
