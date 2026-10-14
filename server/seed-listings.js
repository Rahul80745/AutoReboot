// Demo listings (ported from the original single-file prototype).
import { SPEC_DEFAULTS, CAT_PREFIX, HOURS_CATS, STATE_CODE, subById } from './catalog.js';

export function buildDemoListings(now = Date.now()) {
  const H = 3600e3;
  const rows = [];
  let n = 0;
  function L(o){
    const key = o.cat==='trucks' ? o.sub : o.cat; const sp = SPEC_DEFAULTS[key];
    const age = new Date().getFullYear() - o.year;
    const pre = o.cat==='trucks' ? subById(o.sub).prefix : CAT_PREFIX[o.cat];
    const hrs = HOURS_CATS.includes(o.cat);
    const l = {
      id: o.id || pre + String(234567 + (n++)*7919).slice(0,6), sellerId:o.seller, category:o.cat, subtype:o.cat==='trucks'?o.sub:null,
      brand:o.brand, model:o.model, title:o.title || `${o.brand} ${o.model}`, year:o.year, tyres:o.tyres||0, emission:o.em||'BS-VI',
      fuel:o.fuel||'Diesel', transmission:o.tr||'Manual', km:o.km ?? (hrs ? 900*Math.max(1,age)+340 : 38000*Math.max(1,age)+7000), engine:o.engine||sp.engine, power:o.power||sp.power,
      load:o.load||sp.load, ownership:o.own||'1st Owner', regNo:o.reg || `${STATE_CODE[o.state]} ${String(10+(n*7)%30).padStart(2,'0')} ${'ABCDEFGHJKLMNPRTUV'[n%18]}${'ABCDEFGHJKLMNPRTUV'[(n*5)%18]} ${String(1000+(n*389)%9000)}`,
      body:o.body||sp.body, city:o.city, state:o.state, price:o.price, negotiable:o.neg!==false,
      description:o.desc || `${o.title || o.brand+' '+o.model} in excellent condition. ${o.own==='2nd Owner'?'Second owner':'Single owner'} vehicle. All papers are clear and up to date. Vehicle is well maintained and ready for immediate use.\nNo any major work required.`,
      highlights:o.hl || ['Excellent Running Condition','Regularly Serviced', o.tyres?'New Tyres':'Insurance Valid', key==='tippers'?'Tipper Body in Good Condition':key==='lorries'?'Heavy Body with Strong Cabin':'Fitness Certificate Valid','Ready to Work – No Work Required'],
      color:o.color, photos:[], status:'active', views: 40 + (n*37)%400, createdAt: now - o.h*H,
    };
    rows.push(l); return l;
  }
  L({id:'LOR123456', seller:'u_venk', cat:'trucks', sub:'lorries', brand:'Tata', model:'LPT 1613', year:2018, tyres:6, em:'BS-IV', city:'Khammam', state:'Telangana', price:1250000, h:2, color:'#1F5FD1', km:105000, engine:'6.7 L', power:'160 HP', load:'13 Ton', reg:'TS 07 UF 1234', body:'Container Body', desc:'Tata LPT 1613 Lorry in excellent condition. Single owner vehicle. All papers are clear and up to date. Vehicle is well maintained and ready for immediate use.\nNo any major work required.'});
  L({seller:'u_sai', cat:'trucks', sub:'lorries', brand:'Ashok Leyland', model:'1616 AVTR', year:2019, tyres:6, em:'BS-IV', city:'Warangal', state:'Telangana', price:1425000, h:3, color:'#F3F4F7'});
  L({seller:'u_sai', cat:'trucks', sub:'lorries', brand:'BharatBenz', model:'1617R', year:2020, tyres:6, em:'BS-VI', city:'Hyderabad', state:'Telangana', price:1780000, h:5, color:'#1BA39C', power:'170 HP', load:'10.5 Ton'});
  L({seller:'u_venk', cat:'trucks', sub:'lorries', brand:'Eicher', model:'Pro 2049', year:2021, tyres:6, em:'BS-VI', city:'Nalgonda', state:'Telangana', price:1390000, h:6, color:'#D63A2F', engine:'3.8 L', power:'140 HP', load:'5 Ton'});
  L({seller:'u_lak', cat:'trucks', sub:'lorries', brand:'Mahindra', model:'Blazo X 28', year:2022, tyres:10, em:'BS-VI', city:'Siddipet', state:'Telangana', price:2350000, h:8, color:'#E2541B', engine:'7.2 L', power:'280 HP', load:'19 Ton'});
  L({seller:'u_sai', cat:'trucks', sub:'lorries', brand:'SML Isuzu', model:'Samrat GS', year:2021, tyres:6, em:'BS-IV', city:'Karimnagar', state:'Telangana', price:1175000, h:10, color:'#F2C230', engine:'3.4 L', power:'120 HP', load:'7 Ton'});
  L({seller:'u_dec', cat:'trucks', sub:'lorries', brand:'BharatBenz', model:'2823R', year:2021, tyres:10, em:'BS-VI', city:'Bengaluru', state:'Karnataka', price:2875000, h:1, color:'#F3F4F7', engine:'7.2 L', power:'280 HP', load:'18 Ton'});
  L({seller:'u_lak', cat:'trucks', sub:'lorries', brand:'Tata', model:'Signa 3118.T', year:2020, tyres:12, em:'BS-VI', city:'Guntur', state:'Andhra Pradesh', price:2690000, h:26, color:'#2E6FDB', power:'250 HP', load:'21 Ton'});
  L({seller:'u_venk', cat:'trucks', sub:'lorries', brand:'Ashok Leyland', model:'Ecomet 1615', year:2017, tyres:6, em:'BS-IV', city:'Nizamabad', state:'Telangana', price:980000, h:30, color:'#F3F4F7', own:'2nd Owner'});
  L({seller:'u_pat', cat:'trucks', sub:'lorries', brand:'Eicher', model:'Pro 3015', year:2019, tyres:6, em:'BS-IV', city:'Kurnool', state:'Andhra Pradesh', price:1520000, h:50, color:'#2D8C4E'});
  // Tippers
  L({seller:'u_sai', cat:'trucks', sub:'tippers', brand:'Tata', model:'Signa 2823.K', title:'Tata Signa 2823.K Tipper', year:2021, tyres:10, em:'BS-VI', city:'Hyderabad', state:'Telangana', price:2850000, h:2, color:'#1F5FD1'});
  L({seller:'u_lak', cat:'trucks', sub:'tippers', brand:'Ashok Leyland', model:'2820', title:'Ashok Leyland 2820 Tipper', year:2020, tyres:10, em:'BS-IV', city:'Vijayawada', state:'Andhra Pradesh', price:2675000, h:3, color:'#4B5563'});
  L({id:'TIP123450', seller:'u_venk', cat:'trucks', sub:'tippers', brand:'BharatBenz', model:'2823C', title:'BharatBenz 2823C Tipper', year:2022, tyres:10, em:'BS-VI', city:'Bangalore', state:'Karnataka', price:3025000, h:4, color:'#E9B21C', km:85000, engine:'7.2 L', power:'232 HP', load:'16 Ton', reg:'KA 01 AB 1234', desc:'BharatBenz 2823C Tipper in excellent condition. Single owner vehicle. All papers are clear and up to date. Vehicle is well maintained and ready for immediate use.\nNo any major work required.'});
  L({seller:'u_kis', cat:'trucks', sub:'tippers', brand:'Eicher', model:'Pro 6028T', title:'Eicher Pro 6028T Tipper', year:2021, tyres:10, em:'BS-VI', city:'Nagpur', state:'Maharashtra', price:2450000, h:5, color:'#D63A2F'});
  L({seller:'u_pat', cat:'trucks', sub:'tippers', brand:'Mahindra', model:'Blazo X 28 Tipper', year:2022, tyres:10, em:'BS-VI', city:'Indore', state:'Madhya Pradesh', price:2780000, h:6, color:'#E2541B'});
  L({seller:'u_sai', cat:'trucks', sub:'tippers', brand:'SML Isuzu', model:'Samrat GS Tipper', year:2021, tyres:6, em:'BS-IV', city:'Karimnagar', state:'Telangana', price:1790000, h:7, color:'#F2C230', load:'9 Ton'});
  L({seller:'u_rag', cat:'trucks', sub:'tippers', brand:'Volvo Eicher', model:'FMX 460 8x4', title:'Volvo FMX 460 8x4 Tipper', year:2019, tyres:12, em:'BS-IV', city:'Raipur', state:'Chhattisgarh', price:4650000, h:40, color:'#F3F4F7', engine:'12.8 L', power:'460 HP', load:'30 Ton'});
  L({seller:'u_dec', cat:'trucks', sub:'tippers', brand:'Tata', model:'Prima 2830.K', title:'Tata Prima 2830.K Tipper', year:2018, tyres:10, em:'BS-IV', city:'Ballari', state:'Karnataka', price:2150000, h:60, color:'#F3F4F7', own:'2nd Owner'});
  // Tankers
  L({seller:'u_dec', cat:'trucks', sub:'tankers', brand:'Tata', model:'Signa 2818 Tanker', year:2020, tyres:10, em:'BS-VI', city:'Chennai', state:'Tamil Nadu', price:2400000, h:9, color:'#E5194D', load:'24 KL'});
  L({seller:'u_lak', cat:'trucks', sub:'tankers', brand:'Ashok Leyland', model:'2620 Fuel Tanker', year:2019, tyres:10, em:'BS-IV', city:'Visakhapatnam', state:'Andhra Pradesh', price:2150000, h:20, color:'#F59E0B', load:'20 KL'});
  L({seller:'u_met', cat:'trucks', sub:'tankers', brand:'BharatBenz', model:'1617R Water Tanker', year:2021, tyres:6, em:'BS-VI', city:'Pune', state:'Maharashtra', price:1690000, h:34, color:'#2563EB', load:'12 KL'});
  L({seller:'u_pat', cat:'trucks', sub:'tankers', brand:'Eicher', model:'Pro 3015 Milk Tanker', year:2022, tyres:6, em:'BS-VI', city:'Anand', state:'Gujarat', price:1840000, h:52, color:'#0EA5E9', load:'10 KL'});
  // Trailers
  L({seller:'u_met', cat:'trucks', sub:'trailers', brand:'Tata', model:'Signa 4825.T', year:2021, tyres:22, em:'BS-VI', city:'Mumbai', state:'Maharashtra', price:3850000, h:12, color:'#A63A2B'});
  L({seller:'u_dec', cat:'trucks', sub:'trailers', brand:'Ashok Leyland', model:'4220 Trailer', year:2019, tyres:22, em:'BS-IV', city:'Kolkata', state:'West Bengal', price:3290000, h:28, color:'#1F6FB2'});
  L({seller:'u_pat', cat:'trucks', sub:'trailers', brand:'BharatBenz', model:'4023T', year:2020, tyres:18, em:'BS-VI', city:'Ludhiana', state:'Punjab', price:3550000, h:44, color:'#2F855A'});
  L({seller:'u_rag', cat:'trucks', sub:'trailers', brand:'Volvo Eicher', model:'Pro 6040', title:'Eicher Pro 6040 Trailer', year:2018, tyres:18, em:'BS-IV', city:'Jamshedpur', state:'Jharkhand', price:2990000, h:70, color:'#C2410C', own:'2nd Owner'});
  // Special purpose
  L({seller:'u_sai', cat:'trucks', sub:'special', brand:'Tata', model:'LPT 1613 Fire Tender', year:2019, tyres:6, em:'BS-IV', city:'Hyderabad', state:'Telangana', price:2200000, h:15, color:'#D62B2B', body:'Fire Tender (4500 L)', load:'4500 L'});
  L({seller:'u_dec', cat:'trucks', sub:'special', brand:'Ashok Leyland', model:'Boss Recovery Truck', year:2018, tyres:6, em:'BS-IV', city:'Bengaluru', state:'Karnataka', price:1450000, h:38, color:'#F59E0B', body:'Crane & Recovery'});
  L({seller:'u_pat', cat:'trucks', sub:'special', brand:'Eicher', model:'Pro 2110 Refuse Compactor', year:2020, tyres:6, em:'BS-VI', city:'Coimbatore', state:'Tamil Nadu', price:1650000, h:64, color:'#16A34A', body:'Refuse Compactor 14 m³'});
  // Mini trucks
  L({seller:'u_gan', cat:'mini-trucks', brand:'Tata', model:'Ace Gold', year:2022, tyres:4, em:'BS-VI', city:'Delhi', state:'Delhi', price:625000, h:1.5, color:'#E9B21C', fuel:'Diesel'});
  L({seller:'u_gan', cat:'mini-trucks', brand:'Mahindra', model:'Bolero Pickup', year:2021, tyres:4, em:'BS-VI', city:'Jaipur', state:'Rajasthan', price:785000, h:18, color:'#9CA3AF', engine:'2.5 L', power:'75 HP', load:'1.7 Ton'});
  L({seller:'u_lak', cat:'mini-trucks', brand:'Ashok Leyland', model:'Dost+', year:2020, tyres:4, em:'BS-IV', city:'Lucknow', state:'Uttar Pradesh', price:540000, h:22, color:'#1F6FB2', engine:'1.5 L', power:'70 HP', load:'1.5 Ton'});
  L({seller:'u_gan', cat:'mini-trucks', brand:'Maruti Suzuki', model:'Super Carry', year:2023, tyres:4, em:'BS-VI', city:'Surat', state:'Gujarat', price:495000, h:46, color:'#3B82F6', fuel:'CNG', engine:'1.2 L', power:'72 HP', load:'0.74 Ton'});
  L({seller:'u_sai', cat:'mini-trucks', brand:'Tata', model:'Intra V30', year:2022, tyres:4, em:'BS-VI', city:'Hyderabad', state:'Telangana', price:735000, h:58, color:'#E5194D', engine:'1.5 L', power:'70 HP', load:'1.3 Ton'});
  // Tractors
  L({seller:'u_kis', cat:'tractors', brand:'Mahindra', model:'575 DI XP', year:2021, city:'Nagpur', state:'Maharashtra', price:710000, h:2.5, color:'#D62B2B'});
  L({seller:'u_pat', cat:'tractors', brand:'Swaraj', model:'744 FE', year:2020, city:'Ludhiana', state:'Punjab', price:620000, h:14, color:'#E2541B', power:'48 HP'});
  L({seller:'u_pat', cat:'tractors', brand:'Sonalika', model:'DI 745 III', year:2019, city:'Bhopal', state:'Madhya Pradesh', price:545000, h:33, color:'#2563EB', power:'50 HP'});
  L({seller:'u_dec', cat:'tractors', brand:'John Deere', model:'5050 D', year:2022, city:'Hubballi', state:'Karnataka', price:845000, h:48, color:'#2F8F3A', power:'50 HP'});
  L({seller:'u_kis', cat:'tractors', brand:'Massey Ferguson', model:'241 DI', year:2018, city:'Agra', state:'Uttar Pradesh', price:480000, h:80, color:'#B91C1C', power:'42 HP', own:'2nd Owner'});
  // Buses
  L({seller:'u_met', cat:'buses', brand:'Ashok Leyland', model:'Lynx', title:'Ashok Leyland Lynx', year:2019, em:'BS-IV', tyres:6, city:'Pune', state:'Maharashtra', price:4200000, h:3.5, color:'#E5194D', load:'45 Seater'});
  L({seller:'u_dec', cat:'buses', brand:'Tata', model:'Starbus Ultra', year:2018, em:'BS-IV', tyres:6, city:'Chennai', state:'Tamil Nadu', price:2650000, h:27, color:'#2563EB', load:'41 Seater'});
  L({seller:'u_sai', cat:'buses', brand:'Eicher', model:'Skyline Pro', year:2020, em:'BS-VI', tyres:6, city:'Hyderabad', state:'Telangana', price:2380000, h:41, color:'#F59E0B', load:'32 Seater'});
  L({seller:'u_dec', cat:'buses', brand:'BharatBenz', model:'1624 Coach', year:2021, em:'BS-VI', tyres:6, city:'Bengaluru', state:'Karnataka', price:5850000, h:66, color:'#7C3AED', load:'49 Seater', power:'240 HP'});
  // Construction
  L({seller:'u_rag', cat:'construction', brand:'JCB', model:'205 NXT', year:2021, em:'BS-IV', city:'Hyderabad', state:'Telangana', price:3650000, h:4.5, color:'#F2B705', load:'20.5 Ton op. weight'});
  L({seller:'u_rag', cat:'construction', brand:'JCB', model:'3DX Super', year:2020, em:'BS-IV', city:'Warangal', state:'Telangana', price:2150000, h:19, color:'#F2B705', body:'Backhoe Loader', power:'76 HP', load:'8 Ton op. weight'});
  L({seller:'u_pat', cat:'construction', brand:'Tata Hitachi', model:'EX 200 LC', year:2019, em:'BS-IV', city:'Raipur', state:'Chhattisgarh', price:4100000, h:36, color:'#EA7A00'});
  L({seller:'u_met', cat:'construction', brand:'CAT', model:'320D2', year:2018, em:'BS-IV', city:'Mumbai', state:'Maharashtra', price:4950000, h:55, color:'#D4A300', power:'148 HP'});
  L({seller:'u_kis', cat:'construction', brand:'Komatsu', model:'PC 210', year:2017, em:'BS-IV', city:'Nashik', state:'Maharashtra', price:3600000, h:90, color:'#E9B21C', own:'2nd Owner'});
  // Farm machines
  L({seller:'u_pat', cat:'farm', brand:'Kartar', model:'4000 Combine', year:2021, em:'BS-IV', city:'Bathinda', state:'Punjab', price:2350000, h:11, color:'#C62828'});
  L({seller:'u_kis', cat:'farm', brand:'Preet', model:'987 Combine', year:2020, em:'BS-IV', city:'Karnal', state:'Haryana', price:1980000, h:31, color:'#2F8F3A'});
  L({seller:'u_dec', cat:'farm', brand:'John Deere', model:'W70 Combine', year:2022, em:'BS-IV', city:'Ludhiana', state:'Punjab', price:3200000, h:57, color:'#2F8F3A', power:'120 HP'});
  L({seller:'u_kis', cat:'farm', brand:'Mahindra', model:'Arjun 605 Harvester', year:2019, em:'BS-IV', city:'Nanded', state:'Maharashtra', price:1550000, h:85, color:'#D62B2B'});
  // Three wheeler
  L({seller:'u_sai', cat:'three-wheeler', brand:'Piaggio', model:'Ape Xtra LDX', year:2022, tyres:3, city:'Hyderabad', state:'Telangana', price:245000, h:7.5, color:'#F5C400'});
  L({seller:'u_gan', cat:'three-wheeler', brand:'Bajaj', model:'Maxima Cargo', year:2021, tyres:3, city:'Madurai', state:'Tamil Nadu', price:210000, h:24, color:'#2F8F3A'});
  L({seller:'u_dec', cat:'three-wheeler', brand:'Mahindra', model:'Treo Zor', year:2023, tyres:3, city:'Bengaluru', state:'Karnataka', price:320000, h:39, color:'#2563EB', fuel:'Electric', engine:'Electric', power:'11 HP', em:'Zero Emission'});
  L({seller:'u_gan', cat:'three-wheeler', brand:'TVS', model:'King Kargo', year:2022, tyres:3, city:'Kanpur', state:'Uttar Pradesh', price:225000, h:62, color:'#F5C400'});
  return rows;
}
