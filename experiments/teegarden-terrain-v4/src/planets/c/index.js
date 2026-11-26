// Teegarden c 의 데이터 묶음. 접속 화면에서 고르거나 주소 ?planet=c 로 연다.
import planet from './planet.json' with { type: 'json' };
import sites from './sites.json' with { type: 'json' };
import hud from './hud.json' with { type: 'json' };
import brief from './planet-brief.json' with { type: 'json' };
import story from './ending-story.json' with { type: 'json' };
import gauges from './gauges.json' with { type: 'json' };
import eventData from './events.json' with { type: 'json' };
import judge from './judge.json' with { type: 'json' };
import week1 from './weeks/week1.json' with { type: 'json' };
import week2 from './weeks/week2.json' with { type: 'json' };
import week3 from './weeks/week3.json' with { type: 'json' };
import week4 from './weeks/week4.json' with { type: 'json' };
import week5 from './weeks/week5.json' with { type: 'json' };

export default { ...planet, sites, hud, brief, story, gauges, eventData, judge, weeks: [week1, week2, week3, week4, week5] };
