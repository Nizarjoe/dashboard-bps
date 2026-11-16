// SINTA PADI — Sistem Informasi SKGB Jawa Tengah (clone spesifikasi)
// Node http murni, tanpa dependensi. Jalankan: node server.js  → port 8200
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');

const PORT=process.env.PORT||8200;
const ROOT=__dirname, PUB=path.join(ROOT,'public'), DATA=path.join(ROOT,'data');
const DB=path.join(DATA,'db.json');
if(!fs.existsSync(DATA)) fs.mkdirSync(DATA,{recursive:true});

/* ============ KONSTANTA ============ */
const KABUPATEN=[["3301","CILACAP"],["3302","BANYUMAS"],["3303","PURBALINGGA"],["3304","BANJARNEGARA"],["3305","KEBUMEN"],["3306","PURWOREJO"],["3307","WONOSOBO"],["3308","MAGELANG"],["3309","BOYOLALI"],["3310","KLATEN"],["3311","SUKOHARJO"],["3312","WONOGIRI"],["3313","KARANGANYAR"],["3314","SRAGEN"],["3315","GROBOGAN"],["3316","BLORA"],["3317","REMBANG"],["3318","PATI"],["3319","KUDUS"],["3320","JEPARA"],["3321","DEMAK"],["3322","SEMARANG"],["3323","TEMANGGUNG"],["3324","KENDAL"],["3325","BATANG"],["3326","PEKALONGAN"],["3327","PEMALANG"],["3328","TEGAL"],["3329","BREBES"],["3371","KOTA MAGELANG"],["3372","KOTA SURAKARTA"],["3373","KOTA SALATIGA"],["3374","KOTA SEMARANG"],["3375","KOTA PEKALONGAN"],["3376","KOTA TEGAL"]];
const PETUGAS_SKGB=["Ignatius Sigit Unggul Prajanto","Bayu Indra Cahyadi","Danang Suprayogi Tugiono","Pujo Susilo","Tulus Yulianto","Arif Nurochman","Fendy Hermawan","Hari Wijoseno","M. Arif Nuryadi","Nur Khamid Tohir","Sodikun","Ulil Ludin","Sigit Setiawan","Supriyadi","Badrun Mustofa"];
const PETUGAS_GILING=["Septiawan Nur Hidayat","Mohamad Mahfud","Sukma Hanggana Putra"];
const HASIL_PENCACAHAN=["1. Berhasil diwawancarai","2. Tidak bersedia diwawancarai","3. Tidak dapat diwawancarai sampai batas akhir pencacahan","4. Belum panen sampai batas waktu pendataan","5. Lewat panen","6. Gagal panen","7. Tidak diwawancarai dengan alasan lainnya"];
const KSA_PETAK_LAIN=["--","Tidak Ada","Ya, Fase V2","Ya, Fase G1","Ya, Fase G2","Ya, Fase G3"];
const FASE_OPSI=["1. Vegetatif Awal","2. Vegetatif Akhir","3. Generatif - 3.1 Generatif 1 (G1)","3. Generatif - 3.2 Generatif 2 (G2)","3. Generatif - 3.3 Generatif 3 (G3)","4. Panen"];
const JENIS_PEMANENAN=["1. Dipanen sendiri (tidak ditebaskan)","2. Ditebaskan, penebas bisa dijangkau","3. Ditebaskan, penebas tidak bisa dijangkau"];

/* ============ SEED DATA (dummy realistik, pola realisasi snapshot) ============ */
function seed(){
  const d={users:{},panen:[],panen33:[],utker:[],utgil:[],ksaMei:[],ksaJuni:[],kering1:[],direktori:[],penggantiGiling:[],gilingInput:[],target:{}};
  // users: kode kab, password = kode. superadmin = 9999. admin prov = 0000.
  for(const [kode,nama] of KABUPATEN) d.users[kode]={p:kode,nama,role:'kab'};
  d.users['0000']={p:'0000',nama:'Admin Provinsi',role:'admin'};
  d.users['9999']={p:'9999',nama:'Superadmin',role:'superadmin'};
  // target & realisasi per kab
  const tgK={3301:128,3302:96,3303:88,3304:72,3305:140,3306:64,3307:100,3308:90,3309:110,3310:84,3311:76,3312:68,3313:92,3314:70,3315:118,3316:66,3317:60,3318:74,3319:56,3320:82,3321:64,3322:58,3323:52,3324:70,3325:48,3326:44,3327:62,3328:56,3329:90,3371:20,3372:24,3373:14,3374:30,3375:16,3376:18};
  const tgG={3301:35,3302:28,3303:22,3304:18,3305:24,3306:20,3307:16,3308:22,3309:26,3310:24,3311:20,3312:18,3313:22,3314:16,3315:28,3316:14,3317:12,3318:18,3319:16,3320:14,3321:16,3322:12,3323:10,3324:14,3325:10,3326:10,3327:12,3328:12,3329:20,3371:6,3372:8,3373:4,3374:10,3375:4,3376:6};
  const rlK={3301:54,3302:40,3303:35,3304:30,3305:67,3306:28,3307:44,3308:39,3309:50,3310:36,3311:33,3312:30,3313:41,3314:31,3315:52,3316:29,3317:26,3318:33,3319:25,3320:37,3321:29,3322:26,3323:23,3324:31,3325:21,3326:20,3327:28,3328:25,3329:40,3371:9,3372:11,3373:7,3374:13,3375:8,3376:8};
  const rlK2={};const rlG={};
  for(const k in tgK){rlK2[k]=Math.max(0,rlK[k]-Math.round(rlK[k]*0.13));rlG[k]=(+k>=3371)?tgG[k]:Math.round(tgG[k]*(0.4+((+k*7)%50)/100));}
  d.target={kering:{},kering2:{},giling:{}};
  for(const k in tgK) d.target.kering[k]={t:tgK[k],r:rlK[k]},d.target.kering2[k]={t:tgK[k],r:rlK2[k]},d.target.giling[k]={t:tgG[k],r:rlG[k]};
  // sampel per kab: utama & cadangan (deterministik)
  let seq=1;
  for(const [kode,nama] of KABUPATEN){
    const nU=Math.max(4,tgK[kode]||40), nC=Math.round(nU*0.6);
    const mk=(jenis,i,id)=>({id,kdkab:kode,jenis,april:FASE_OPSI[i%6],mei:FASE_OPSI[(i+2)%6],juni:FASE_OPSI[(i+4)%6],pengganti:'',utp:['H ROSYID','SUTARNO','WAGIMAN','SLAMET R','PARMAN'][i%5],hp:i%3===0?'08123456'+String(1000+i):'-'});
    for(let i=0;i<nU;i++){const id=kode+'01'+String(100+seq)+'U'+(i+1);d.utker.push({kdkab:kode,idsub:id,status:'Eligible',probable:'',pengganti:''});d.panen.push(mk('Utama',seq,id));seq++;}
    for(let i=0;i<nC;i++){const id=kode+'02'+String(100+seq)+'C'+(i+1);const s={kdkab:kode,idsub:id,status:i%4===0?'Non Eligible':'Eligible',probable:'',pengganti:''};d.utker.push(s);d.panen.push(mk('Cadangan',seq,id));seq++;}
    const nG=Math.max(2,tgG[kode]||8);
    for(let i=0;i<nG;i++){const id=kode+'03'+String(100+seq)+'G'+(i+1);d.utgil.push({kdkab:kode,idsub:id,jenis:'Utama',status:'Eligible',pengganti:''});seq++;}
  }
  // KSA Mei/Juni subset (500 baris) — kolom sesuai spec
  for(const bulan of ['Mei','Juni']){
    const arr=d['ksa'+bulan];
    for(let i=0;i<d.panen.length;i++){
      const s=d.panen[i];
      arr.push({idseg:'3305010'+String(100+i%80),subseg:'B'+(1+i%9),id_subsegmen:s.id,nama:['Sawah Ladang','Sawah Pasang Surut','Sawah Lebak','Tegalan'][i%4],feb:['3.1','3.2','4','5','1','6'][i%6],mar:['3.1','3.2','4','5','1','6'][(i+2)%6],april:['3.1','3.2','4','5','1','6'][(i+3)%6],[bulan.toLowerCase()]:FASE_OPSI[i%6],petak:KSA_PETAK_LAIN[i%6]});
    }
  }
  // direktori penggilingan 1206 baris distributed; 48 for 3305
  const skala=['Besar','Menengah','Kecil'];
  let dseq=0;
  for(const [kode,nama] of KABUPATEN){
    const n=(kode==='3305')?48:Math.max(2,Math.round((1206-48)/34));
    for(let i=0;i<n;i++){dseq++;d.direktori.push({kab:kode,jenis:i%4===0?'CADANGAN':'UTAMA',nama:'Penggilingan '+nama+' '+String.fromCharCode(65+i%26)+(i+1),telp:i%3===0?'0813'+String(20000000+dseq):'',skala:skala[i%3]});}
  }
  // KERING1: realisasi kering tahap1 per kab → baris
  for(const [kode,nama] of KABUPATEN){
    const n=d.target.kering[kode].r;
    for(let i=0;i<n;i++){
      const s=d.panen.find(p=>p.kdkab===kode&&p.jenis==='Utama'&&p.id.endsWith(String((i+1))))||d.panen.find(p=>p.kdkab===kode);
      const anom=(i%9===5); // ~1/9 anomali
      d.kering1.push({kab:kode,petugas:PETUGAS_SKGB[i%15],jenis:'Utama',id:s?s.id:kode+'X'+i,hasil:anom?HASIL_PENCACAHAN[1+(i%6)]:HASIL_PENCACAHAN[0],tgl1:'2026-05-'+String(5+i%25).padStart(2,'0'),lok1:'-7.7'+(i%9)+', 109.6'+(i%9),w305a:12+i%7,w305b:120+i%90,w305c:14+(i%40)/10});
    }
  }
  // Panen33 identifikasi: 68 baris utk Kebumen snapshot-like
  const km=d.panen.filter(p=>p.kdkab==='3305').slice(0,68);
  km.forEach((s,i)=>{
    const sudah=(i%3!==0);
    d.panen33.push({kab:'3305',petugas:PETUGAS_SKGB[i%15],jenis:s.jenis,id:s.id,hasil:sudah?'2. Sudah Panen':'1. Belum Panen',petak:sudah?(i%2?'1. Ya':'2. Tidak'):'',perk:sudah&&i%2?'2026-05-'+String(10+i%18):'',pemanen:sudah&&i%2?JENIS_PEMANENAN[i%3]:'',hp2:sudah&&i%2?'0812'+String(34567890+i):'',lok:sudah&&i%2?'-7.6'+(i%9)+', 109.6'+(i%9):'',cat:''});
  });
  return d;
}
function loadDB(){ try{ return JSON.parse(fs.readFileSync(DB,'utf8')); }catch(e){ const d=seed(); fs.writeFileSync(DB,JSON.stringify(d)); return d; } }
let db=loadDB();
const GSHEETS=require('./data/gsheets.json');
const gsCache=new Map(); // sid:gid → {t,data}
async function fetchGSheet(sid,gid){
  const key=sid+':'+gid;
  const c=gsCache.get(key);
  if(c&&Date.now()-c.t<5*60*1000) return c.data;
  const url=`https://docs.google.com/spreadsheets/d/${sid}/export?format=csv&gid=${gid}`;
  const resp=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
  if(!resp.ok) throw new Error('GSheet fetch '+resp.status);
  const csv=await resp.text();
  // parse CSV sederhana (tangani kutip)
  const rows=[];let row=[],cell='',inq=false;
  for(let i=0;i<csv.length;i++){const ch=csv[i];
    if(inq){ if(ch==='"'&&csv[i+1]==='"'){cell+='"';i++;} else if(ch==='"'){inq=false;} else cell+=ch; }
    else if(ch==='"') inq=true;
    else if(ch===','){row.push(cell);cell='';}
    else if(ch===String.fromCharCode(13)){continue;}
    else if(ch===String.fromCharCode(10)){row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=ch;}
  if(cell||row.length){row.push(cell);rows.push(row);}
  // buang baris & kolom kosong di tepi
  const data=rows.filter(r=>r.some(v=>String(v).trim()!==''));
  const maxLen=Math.max(...data.map(r=>r.length));
  // trim trailing empty columns
  let lastCol=0;
  data.forEach(r=>r.forEach((v,ci)=>{if(String(v).trim()!=='')lastCol=Math.max(lastCol,ci)}));
  const out=data.map(r=>r.slice(0,lastCol+1));
  gsCache.set(key,{t:Date.now(),data:out});
  return out;
}
const saveDB=()=>fs.writeFileSync(DB,JSON.stringify(db));

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json','.geojson':'application/json'};

/* ============ AUTH ============ */
const sessions=new Map();
const token=()=>crypto.randomBytes(24).toString('hex');

/* ============ HELPERS ============ */
const J=(res,code,obj)=>{const b=JSON.stringify(obj);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(b)});res.end(b);};
const readBody=(req)=>new Promise(r=>{let c='';req.on('data',d=>c+=d);req.on('end',()=>{try{r(JSON.parse(c||'{}'))}catch(e){r({})}});});
const userOf=(req)=>{const t=(req.headers.authorization||'').replace('Bearer ','');return sessions.get(t);};

/* ============ ROUTES API ============ */
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://x');
  const p=url.pathname;
  try{
  /* ---- AUTH ---- */
  if(p==='/api/login'&&req.method==='POST'){
    const b=await readBody(req);
    const u=db.users[String(b.username||'').trim()];
    if(u&&u.p===String(b.password||'').trim()){
      const t=token();sessions.set(t,{kode:String(b.username).trim(),nama:u.nama,role:u.role});
      return J(res,200,{ok:true,token:t,user:{kode:String(b.username).trim(),nama:u.nama,role:u.role}});
    }
    return J(res,401,{ok:false,error:'Username atau password salah. Hubungi Admin BPS Provinsi Jawa Tengah jika lupa.'});
  }
  /* ---- STATIC (non-API) ---- */
  if(!p.startsWith('/api/')){
    let fp=path.join(PUB,p==='/'?'index.html':p);
    if(!fp.startsWith(PUB)) return J(res,403,{error:'Forbidden'});
    if(!fs.existsSync(fp)) fp=path.join(PUB,'index.html');
    if(!fs.existsSync(fp)){res.writeHead(404);return res.end('index.html belum ada');}
    const ext=path.extname(fp).toLowerCase();
    res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-store'});
    return res.end(fs.readFileSync(fp));
  }
  const me=userOf(req);
  if(p==='/api/me'&&me) return J(res,200,{user:{kode:me.kode,nama:me.nama,role:me.role}});

  /* ---- KONSTANTA ---- */
  if(p==='/api/constants') return J(res,200,{kabupaten:KABUPATEN,petugas:PETUGAS_SKGB,petugasGiling:PETUGAS_GILING,hasilPencacahan:HASIL_PENCACAHAN,ksaPetakLain:KSA_PETAK_LAIN,faseOpsi:FASE_OPSI,jenisPemanenan:JENIS_PEMANENAN});

  if(!me) return J(res,401,{error:'Belum login'});

  /* ---- DASHBOARD / REALISASI ---- */
  if(p==='/api/realisasi'&&req.method==='GET'){
    const rows=KABUPATEN.map(([kode,nama])=>({kode,nama,tK:db.target.kering[kode].t,rK:db.target.kering[kode].r,tK2:db.target.kering2[kode].r,rK2:db.target.kering2[kode].r,tG:db.target.giling[kode].t,rG:db.target.giling[kode].r}));
    const tot=rows.reduce((a,r)=>({tK:a.tK+r.tK,rK:a.rK+r.rK,tK2:a.tK2+r.tK2,rK2:a.rK2+r.rK2,tG:a.tG+r.tG,rG:a.rG+r.rG}),{tK:0,rK:0,tK2:0,rK2:0,tG:0,rG:0});
    return J(res,200,{rows,total:tot});
  }
  if(p==='/api/kpi'&&req.method==='GET'){
    const elU=db.utker.filter(s=>s.jenis!=='Cadangan'&&s.status==='Eligible').length;
    const elC=db.utker.filter(s=>s.jenis==='Cadangan'&&s.status==='Eligible').length;
    const elGU=db.utgil.filter(s=>s.status==='Eligible').length;
    // fallback: utker has no jenis; derive from id pattern C
    const elU2=db.utker.filter(s=>!/-?C\d+$|C\d+$/.test(s.idsub)&&s.status==='Eligible').length;
    const elC2=db.utker.filter(s=>/-?C\d+$|C\d+$/.test(s.idsub)&&s.status==='Eligible').length;
    const r1=db.kering1.filter(k=>k.hasil===HASIL_PENCACAHAN[0]).length;
    return J(res,200,{utamaKering:elU2||elU,cadanganKering:elC2||elC,utamaGiling:elGU,cadanganGiling:0,keringT1:r1});
  }

  /* ---- SHEETS (read / append / updateCell — gaya Apps Script) ---- */
  const SHEETS={panen:()=>db.panen,panen33:()=>db.panen33,utker:()=>db.utker,utgil:()=>db.utgil,'ksa-mei':()=>db.ksaMei,'ksa-juni':()=>db.ksaJuni,kering1:()=>db.kering1,direktori:()=>db.direktori,penggantigiling:()=>db.penggantiGiling,giling:()=>db.gilingInput};
  const HEADERS={panen:['ID SUBSEGMEN','KDKAB','JENIS SAMPEL','BULAN APRIL','AMATAN MEI','AMATAN JUNI','SAMPEL PENGGANTI','NAMA PENGELOLA UTP','NO HP','STATUS ELIGIBLE'],
    panen33:['KABUPATEN/KOTA','NAMA PETUGAS','JENIS SAMPEL','ID SAMPEL','HASIL IDENTIFIKASI TITIK AMATAN SUBSEGMEN','APAKAH ADA PETAK LAIN DALAM SUBSEGMEN TERPILIH YANG AKAN PANEN?','PERKIRAAN PANEN','JENIS PEMANENAN','APAKAH HASIL PANEN BISA LEBIH DARI 200 KG DI PETAK TERSEBUT?','NO HP PETANI/PENEBAS','LOKASI SAWAH','CATATAN','TIMESTAMP'],
    utker:['KDKAB','IDSUBSEGMEN','STATUS ELIGIBLE','STATUS PROBABLE','SAMPEL PENGGANTI'],
    utgil:['KDKAB','IDSUBSEGMEN','JENIS SAMPEL','STATUS ELIGIBLE','SAMPEL PENGGANTI'],
    'ksa-mei':['ID SEGMEN','SUBSEGMEN','ID_SUBSEGMEN','NAMA','FEB','MAR','APRIL','MEI','APAKAH DI SEKITAR TITIK AMATAN SUBSEGMEN TERSEBUT ADA PETAK LAIN YANG AKAN ATAU SIAP PANEN (V2, G1, G2 DAN G3)'],
    'ksa-juni':['ID SEGMEN','SUBSEGMEN','ID_SUBSEGMEN','NAMA','FEB','MAR','APRIL','MEI','JUNI','APAKAH DI SEKITAR TITIK AMATAN SUBSEGMEN TERSEBUT ADA PETAK LAIN YANG AKAN ATAU SIAP PANEN (V2, G1, G2 DAN G3)'],
    kering1:['KABUPATEN/KOTA','NAMA PETUGAS SKGB','JENIS SAMPEL','ID SUBSEGMEN','207. HASIL PENCACAHAN','TANGGAL KUNJUNGAN PERTAMA (SAAT PANEN)','LOKASI (PANEN)','305.A. BERAT WADAH (PANEN)','305.B. BERAT GABAH DAN WADAH (PANEN)','305.C. RATA-RATA KADAR AIR (PANEN)'],
    direktori:['KABUPATEN/KOTA','JENIS','NAMA PENGGILINGAN','TELEPON','SKALA'],
    penggantigiling:['KAB','PENGGILINGAN UTAMA','SAMPEL PENGGANTI','TIMESTAMP'],
    giling:['KABUPATEN/KOTA','NAMA PETUGAS SKGB GILING','JENIS SAMPEL','NAMA PENGGILINGAN','SKALA','TANGGAL PENDATAAN','LOKASI PENGGILINGAN','115. HASIL PENCACAHAN','401.A. BERAT WADAH (GKG)','401.B. BERAT GABAH (GKG) + WADAH','401.C. RATA-RATA KADAR AIR (GKG)','403.A. BERAT WADAH (BERAS)','403.B. BERAT BERAS + WADAH','403.C. RATA-RATA KADAR AIR BERAS']};
  if(p.startsWith('/api/sheet/')&&req.method==='GET'){
    const name=p.split('/')[3], f=SHEETS[name];
    if(!f) return J(res,404,{error:'Sheet not found'});
    let rows=f().map(r=>({...r}));
    const kab=url.searchParams.get('kab');
    const effKab=(me.role==='kab')?me.kode:kab;
    if(effKab) rows=rows.filter(r=>(r.kdkab||r.kab||r.KABUPATEN_SLUG||String(r.id||r.idsub||r.id_subsegmen||'').slice(0,4))===effKab);
    return J(res,200,{header:HEADERS[name]||Object.keys(rows[0]||{}),data:rows});
  }
  if(p.startsWith('/api/sheet/')&&req.method==='POST'){
    const name=p.split('/')[3], f=SHEETS[name];
    if(!f) return J(res,404,{error:'Sheet not found'});
    if(me.role==='kab'){ /* kab boleh append & updateCell sendiri */ }
    const b=await readBody(req);
    if(b.action==='submit'){
      const row=b.data||{};
      if(name==='panen33'){db.panen33.push({kab:row.kab||me.kode,petugas:row.petugas,jenis:row.jenis,id:row.id,hasil:row.hasil,petak:row.petak||'',perk:row.perk||'',pemanen:row.pemanen||'',hp2:row.hp2||'',lok:row.lok||'',cat:row.cat||'',ts:new Date().toISOString()});}
      else if(name==='kering1'){db.kering1.push({kab:row.kab||me.kode,petugas:row.petugas,jenis:row.jenis,id:row.id,hasil:row.hasil,tgl1:row.tgl1||'',lok1:row.lok1||'',w305a:row.w305a||'',w305b:row.w305b||'',w305c:row.w305c||''});}
      else if(name==='giling'){db.gilingInput.push({kab:row.kab||me.kode,petugas:row.petugas,jenis:row.jenis,peng:row.peng,skala:row.skala,tgl:row.tgl,lok:row.lok||'',hasil:row.hasil,gA:row.gA||'',gB:row.gB||'',gC:row.gC||'',bA:row.bA||'',bB:row.bB||'',bC:row.bC||''});}
      else if(name==='penggantigiling'){db.penggantiGiling.push({kab:row.kab||me.kode,pengUtama:row.pengUtama,pengganti:row.pengganti,ts:new Date().toISOString()});}
      else return J(res,400,{error:'Submit tidak didukung ke sheet ini'});
      saveDB(); return J(res,200,{success:true});
    }
    if(b.action==='updateCell'){
      const arr=f(); const key=b.matchValue;
      let hit=null;
      for(const r of arr){ if(r.id===key||r.idsub===key||r.id_subsegmen===key||r.ID_SUBSEGMEN===key){hit=r;break;} }
      if(!hit) return J(res,404,{success:false,message:'Row not found'});
      const col=b.targetColumn;
      if(col==='petak'||col==='APAKAH DI SEKITAR TITIK AMATAN SUBSEGMEN TERSEBUT ADA PETAK LAIN YANG AKAN ATAU SIAP PANEN (V2, G1, G2 DAN G3)') hit.petak=b.value;
      else if(col==='pengganti'||col==='SAMPEL PENGGANTI') hit.pengganti=b.value;
      else if(hit[col]!==undefined) hit[col]=b.value;
      else return J(res,400,{success:false,message:'Column not found'});
      saveDB(); return J(res,200,{success:true});
    }
    return J(res,400,{error:'Unknown action'});
  }

  /* ---- GOOGLE SHEETS REAL DATA ---- */
  if(p==='/api/gsheets'&&req.method==='GET'){
    return J(res,200,{sheets:GSHEETS.map(([bidang,survei,label,sid,gid])=>({bidang,survei,label,sid,gid}))});
  }
  if(p==='/api/gsheet'&&req.method==='GET'){
    const sid=url.searchParams.get('sid'),gid=url.searchParams.get('gid')||'0';
    try{
      const rows=await fetchGSheet(sid,gid);
      return J(res,200,{rows});
    }catch(e){return J(res,502,{error:'Gagal memuat sheet: '+String(e.message||e)})}
  }

  /* ---- REKAP KSA ---- */
  if(p==='/api/ksa-rekap'&&req.method==='GET'){
    const bulan=url.searchParams.get('bulan')||'Mei';
    const arr=bulan==='Juni'?db.ksaJuni:db.ksaMei;
    const re={};
    for(const r of arr){const kab=String(r.id_subsegmen).slice(0,4);re[kab]=re[kab]||{kab,target:0,tdk:0,v2:0,g1:0,g2:0,g3:0};
      if(r.petak==='Tidak Ada')re[kab].tdk++;else if(r.petak==='Ya, Fase V2')re[kab].v2++;else if(r.petak==='Ya, Fase G1')re[kab].g1++;else if(r.petak==='Ya, Fase G2')re[kab].g2++;else if(r.petak==='Ya, Fase G3')re[kab].g3++;}
    const rows=KABUPATEN.filter(([k])=>me.role==='kab'?k===me.kode:true).map(([k,n])=>({kab:k,nama:n,target:(re[k]?re[k].tdk+re[k].v2+re[k].g1+re[k].g2+re[k].g3:0)||0,tdk:re[k]?re[k].tdk:0,v2:re[k]?re[k].v2:0,g1:re[k]?re[k].g1:0,g2:re[k]?re[k].g2:0,g3:re[k]?re[k].g3:0}));
    return J(res,200,{rows});
  }

  /* ---- MONITORING GC ---- */
  if(p==='/api/monitoring-gc'&&req.method==='GET'){
    const jenis=url.searchParams.get('jenis')||'Utama';
    const rows=db.panen33.filter(r=>r.jenis===jenis);
    const agg={};
    for(const r of rows){const kab=r.kab;agg[kab]=agg[kab]||{belum:0,sudah:0,ya:0,tdk:0,sendiri:0,tj:0,ttj:0};
      if(r.hasil==='1. Belum Panen')agg[kab].belum++;else if(r.hasil==='2. Sudah Panen')agg[kab].sudah++;
      if(r.petak==='1. Ya')agg[kab].ya++;else if(r.petak==='2. Tidak')agg[kab].tdk++;
      if(r.pemanen===JENIS_PEMANENAN[0])agg[kab].sendiri++;else if(r.pemanen===JENIS_PEMANENAN[1])agg[kab].tj++;else if(r.pemanen===JENIS_PEMANENAN[2])agg[kab].ttj++;}
    const out=KABUPATEN.map(([k,n])=>({kode:k,nama:n,...(agg[k]||{belum:0,sudah:0,ya:0,tdk:0,sendiri:0,tj:0,ttj:0})})).map(r=>({...r,total:r.belum+r.sudah}));
    const tot=out.reduce((a,r)=>({belum:a.belum+r.belum,sudah:a.sudah+r.sudah,ya:a.ya+r.ya,tdk:a.tdk+r.tdk,sendiri:a.sendiri+r.sendiri,tj:a.tj+r.tj,ttj:a.ttj+r.ttj,total:a.total+r.total}),{belum:0,sudah:0,ya:0,tdk:0,sendiri:0,tj:0,ttj:0,total:0});
    return J(res,200,{rows:out,total:tot});
  }

  /* ---- ADMIN: user management (superadmin) ---- */
  if(p==='/api/users'&&req.method==='GET'&&me.role==='superadmin'){return J(res,200,{users:Object.entries(db.users).map(([k,v])=>({kode:k,nama:v.nama,role:v.role}))});}
  if(p==='/api/users'&&req.method==='POST'&&me.role==='superadmin'){
    const b=await readBody(req);const kode=String(b.kode||'').trim();
    if(!kode||db.users[kode]) return J(res,400,{error:'Kode tidak valid / sudah ada'});
    db.users[kode]={p:kode,nama:b.nama||kode,role:b.role||'kab'};saveDB();return J(res,200,{ok:true});
  }

  return J(res,404,{error:'Not found'});  }catch(e){return J(res,500,{error:String(e&&e.message||e)});}
});

/* ============ STATIC ============ */
server.on('clientError',(err,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.listen(PORT,()=>console.log('SINTA PADI running on http://localhost:'+PORT));
