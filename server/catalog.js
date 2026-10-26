// Shared catalog constants (mirrors the frontend catalog).
const SUBS = [
  {id:'lorries', name:'Lorries / DCM', desc:'Used for transporting goods and materials', icon:'truck', tint:'red', color:'#F3F4F7', prefix:'LOR'},
  {id:'tippers', name:'Tippers', desc:'Used for construction, mining and heavy duty work', icon:'tipper', tint:'amber', color:'#E9B21C', prefix:'TIP'},
  {id:'tankers', name:'Tankers', desc:'Used for transporting liquids and gases', icon:'tanker', tint:'blue', color:'#E5194D', prefix:'TAN'},
  {id:'trailers', name:'Trailers', desc:'Used for long distance and heavy load transport', icon:'trailer', tint:'green', color:'#A63A2B', prefix:'TRL'},
  {id:'special', name:'Special Purpose Vehicles', desc:'Includes fire, recovery, municipal and other utility vehicles', icon:'ladder', tint:'violet', color:'#D62B2B', prefix:'SPV'},
];
const CAT_PREFIX = {'mini-trucks':'MIN', tractors:'TRC', buses:'BUS', construction:'CON', farm:'FRM', 'three-wheeler':'TWL'};
export const CATEGORY_IDS = ['trucks','mini-trucks','tractors','buses','construction','farm','three-wheeler'];
export { SUBS, CAT_PREFIX };
export const HOURS_CATS = ['tractors','construction','farm'];
export const STATES = ['Andhra Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Odisha','Punjab','Rajasthan','Tamil Nadu','Telangana','Uttar Pradesh','Uttarakhand','West Bengal'];
export const STATE_CODE = {'Andhra Pradesh':'AP','Assam':'AS','Bihar':'BR','Chhattisgarh':'CG','Delhi':'DL','Goa':'GA','Gujarat':'GJ','Haryana':'HR','Himachal Pradesh':'HP','Jharkhand':'JH','Karnataka':'KA','Kerala':'KL','Madhya Pradesh':'MP','Maharashtra':'MH','Odisha':'OD','Punjab':'PB','Rajasthan':'RJ','Tamil Nadu':'TN','Telangana':'TS','Uttar Pradesh':'UP','Uttarakhand':'UK','West Bengal':'WB'};
export const SPEC_DEFAULTS = {
  lorries:{engine:'5.6 L',power:'180 HP',load:'10 Ton',body:'Open Body (High Deck)'},
  tippers:{engine:'7.2 L',power:'232 HP',load:'16 Ton',body:'Tipper'},
  tankers:{engine:'5.9 L',power:'180 HP',load:'18 KL',body:'Tanker'},
  trailers:{engine:'8.9 L',power:'400 HP',load:'35 Ton',body:'Container / Trailer'},
  special:{engine:'5.6 L',power:'180 HP',load:'—',body:'Utility Body'},
  'mini-trucks':{engine:'0.8 L',power:'40 HP',load:'1 Ton',body:'Open Deck'},
  tractors:{engine:'3.0 L',power:'47 HP',load:'1.6 Ton lift',body:'Tractor'},
  buses:{engine:'5.6 L',power:'200 HP',load:'45 Seater',body:'Bus'},
  construction:{engine:'5.9 L',power:'140 HP',load:'20 Ton op. weight',body:'Excavator'},
  farm:{engine:'6.0 L',power:'101 HP',load:'—',body:'Combine Harvester'},
  'three-wheeler':{engine:'0.6 L',power:'12 HP',load:'0.5 Ton',body:'Cargo Deck'},
};
export const subById = id => SUBS.find(s=>s.id===id);
export const EMISSIONS = ['BS-VI','BS-IV','BS-III','Zero Emission'];
export const FUELS = ['Diesel','CNG','Petrol','Electric'];
