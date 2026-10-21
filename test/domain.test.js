import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/domain.js';
const {metrics,parseCSV,csv,importCSV,fields,windowDates,groupTerms} = globalThis.UpelfDomain;
test('ratios use aggregated numerators and denominators',()=>{const m=metrics([{曝光:100,点击:10,花费:10,订单:2,销售额:20},{曝光:900,点击:90,花费:180,订单:9,销售额:900}]);assert.equal(m.cpc,1.9);assert.equal(m.cvr,.11);assert.equal(m.acos,190/920);});
test('missing data and zero denominators remain unknown',()=>{assert.equal(metrics([]).spend,null);assert.equal(metrics([{曝光:0,点击:0,花费:0,订单:0,销售额:null}]).cpc,null);assert.equal(metrics([{花费:1},{花费:null}]).spend,null);});
test('CSV quotes, commas and multiline cells round trip',()=>{const rows=[['a','b'],['x,y','a"b\nc']];assert.deepEqual(parseCSV(csv(rows).replace(/^\uFEFF/,'')),rows);assert.throws(()=>parseCSV('"unclosed'));});
function validRow(){return fields.map(k=>({店铺:'Upelf',站点:'US',广告类型:'SP',归因口径:'7天订单',日期:'2026-10-01',广告活动ID:'c1',广告组ID:'g1',曝光:'100',点击:'10',花费:'5',订单:'2',销售额:'20'})[k]||'');}
test('import validates scope, missing numbers and calendar dates',()=>{const row=validRow();assert.equal(importCSV(csv([fields,row]))[0].点击,10);row[fields.indexOf('花费')]='';assert.equal(importCSV(csv([fields,row]))[0].花费,null);row[fields.indexOf('日期')]='2026-02-30';assert.throws(()=>importCSV(csv([fields,row])));row[fields.indexOf('日期')]='2026-10-01';row[fields.indexOf('广告组ID')]='';assert.throws(()=>importCSV(csv([fields,row])));});
test('independent vs rolling windows',()=>{assert.deepEqual(windowDates('2026-10-20'),{start:'2026-10-07',end:'2026-10-20',previousStart:'2026-09-23',previousEnd:'2026-10-06',rollingStart:'2026-09-30',rollingEnd:'2026-10-13'});});
test('terms remain scoped to ad groups',()=>{const r=importCSV(csv([fields,validRow()]))[0];assert.equal(groupTerms([r,{...r,广告组ID:'g2'}]).length,2);assert.equal(groupTerms([r,r])[0].m.clicks,20);});
