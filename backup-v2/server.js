// Dashboard Monitoring Produksi 3305 — BPS Kabupaten Kebumen
// Node http murni, tanpa dependensi. Jalankan: node server.js
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');

const PORT=process.env.PORT||8200;
const ROOT=__dirname, PUB=path.join(ROOT,'public'), DATA=path.join(ROOT,'data'), UPL=path.join(ROOT,'uploads');
const DB=path.join(DATA,'db.json');
for(const d of [DATA,UPL]) if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true});

/* ================= SEED ================= */
const PROGRAM_SEED=[
 ['tp','Survei Kerangka Sampel Area (KSA) 2026',2026,900],
 ['tp','Survei Ubinan Padi Subround 1 2026',2026,144],
 ['tp','Survei Ubinan Padi Subround 2 2026',2026,144],
 ['tp','Survei Ubinan Palawija 2026',2026,120],
 ['tp','Survei Konversi Jagung (SKJG) 2026',2026,96],
 ['tp','Survei Konversi Gabah ke Beras 2026',2026,64],
 ['inpek','Survei IMK Tahunan 2026',2026,420],
 ['inpek','Survei IMK Triwulanan 2026',2026,126],
 ['inpek','Survei DPA, STPIM dan IBSTR 2026',2026,88],
 ['inpek','Survei Galian URT 2026',2026,72],
 ['inpek','Updating Direktori Perusahaan PE 2026',2026,310],
 ['inpek','Survei Konstruksi 2026',2026,58],
 ['horti','Survei Pertanian Terintegrasi (SPT) 2026',2026,520],
 ['horti','Survei Kesejahteraan Petani (SKP) 2026',2026,180],
 ['horti','Survei Komstrat 2026',2026,240],
 ['horti','Survei VIP Hortikultura 2026',2026,165],
 ['horti','Survei DPP DUTL 2026',2026,132]
];
const MITRA_SEED=[
 ['Ahmad Fauzi','mitra1','Kebumen'],
 ['Siti Nurhaliza','mitra2','Gombong'],
 ['Budi Santoso','mitra3','Kutowinangun'],
 ['Dewi Lestari','mitra4','Prembun'],
 ['Rizki Ramadhan','mitra5','Karanganyar'],
 ['Nur Aisyah','mitra6','Alian']
];
const BIDANG=[
 {id:'tp',nama:'Statistik Tanaman Pangan',ikon:'🌾'},
 {id:'inpek',nama:'Statistik INPEK',ikon:'🏭'},
 {id:'horti',nama:'Statistik Horti, Perkebunan, Peternakan & Perikanan',ikon:'🐄'}
];

function build(){
  const d={users:[
      {u:'superadmin',p:'bps3305',role:'superadmin',n:'Super Admin BPS Kebumen',wilayah:'Kebumen',hp:'',email:''},
      {u:'admin',p:'bps3305',role:'admin',n:'Admin Statistik Produksi',wilayah:'Kebumen',hp:'',email:''}
    ],
    bidang:BIDANG, programs:[], assignments:[], laporan:[], foto:[], aktivitas:[], meta:{
      instansi:'BPS Kabupaten Kebumen', unit:'Tim Statistik Produksi 3305', tahun:2026
    }};
  MITRA_SEED.forEach(([n,u,w])=>{
    d.users.push({u,p:'mitra3305',role:'mitra',n,wilayah:w,hp:'',email:''});
  });
  let pi=1;
  for(const [bid,nama,tahun,target] of PROGRAM_SEED){
    d.programs.push({
      id:'PRG-'+String(pi++).padStart(3,'0'), nama, bidang:bid, tahun, target,
      unit:'sampel/BS', deskripsi:'Monitoring pelaksanaan pendataan lapangan oleh mitra statistik.',
      mulai:tahun+'-02-01', deadline:tahun+'-11-30',
      status:'Berjalan', wajibFoto:true,
      fields:[{key:'jumlah',label:'Jumlah sampel/BS selesai',tipe:'number',wajib:true},
              {key:'catatan',label:'Catatan kendala lapangan',tipe:'text',wajib:false}]
    });
  }
  [['Survei Ubinan Padi Subround 1 2025','tp',144],['Survei Ubinan Padi Subround 2 2025','tp',144],
   ['Survei IMK Triwulan 3 2025','inpek',126],['Survei Galian BH 2025','inpek',38]]
   .forEach(([nama,bid,target])=>{
     d.programs.push({id:'PRG-'+String(pi++).padStart(3,'0'),nama,bidang:bid,tahun:2025,target,
       unit:'sampel/BS',deskripsi:'Arsip pelaksanaan tahun 2025.',mulai:'2025-01-10',deadline:'2025-12-15',
       status:'Selesai',wajibFoto:false,fields:[{key:'jumlah',label:'Jumlah selesai',tipe:'number',wajib:true}]});
   });
  const aktif=d.programs.filter(p=>p.tahun===2026);
  const mitra=d.users.filter(u=>u.role==='mitra');
  let ai=1;
  for(const p of aktif){
    for(const m of mitra){
      const share=Math.round(p.target/mitra.length);
      d.assignments.push({id:'ASG-'+String(ai++).padStart(4,'0'),programId:p.id,mitraU:m.u,
        target:share,selesai:0,status:'Belum Mulai',updatedAt:Date.now()});
    }
  }
  const seedLap=[['mitra1','PRG-001',42],['mitra1','PRG-002',18],['mitra2','PRG-001',36],
    ['mitra2','PRG-004',12],['mitra3','PRG-001',28],['mitra3','PRG-007',22],['mitra4','PRG-001',20],
    ['mitra4','PRG-013',35],['mitra5','PRG-002',14],['mitra5','PRG-009',9],['mitra6','PRG-001',16],
    ['mitra6','PRG-015',25]];
  let li=1;
  for(const [mu,pid,jml] of seedLap){
    const a=d.assignments.find(x=>x.programId===pid&&x.mitraU===mu); if(!a) continue;
    const mitraN=d.users.find(u=>u.u===mu).n;
    a.selesai=Math.min(a.target,jml);
    a.status=a.selesai>=a.target?'Selesai':'Berjalan';
    d.laporan.unshift({id:'LPR-'+String(li++).padStart(4,'0'),programId:pid,mitraU:mu,mitraN,
      jumlah:jml,catatan:'Pendataan lapangan selesai sesuai jadwal.',foto:[],t:Date.now()-li*3600*1000,
      verified:li%3!==0,verifiedBy:li%3!==0?'Admin Statistik Produksi':'',verifiedAt:li%3!==0?Date.now():0});
  }
  d.aktivitas.push({t:Date.now(),oleh:'Sistem',aksi:'Dashboard disiapkan',detail:'17 program 2026 · '+mitra.length+' mitra statistik'});
  return d;
}
function load(){
  if(!fs.existsSync(DB)){const d=build();fs.writeFileSync(DB,JSON.stringify(d,null,1));return d;}
  try{return JSON.parse(fs.readFileSync(DB,'utf8'));}catch(e){const d=build();fs.writeFileSync(DB,JSON.stringify(d,null,1));return d;}
}
const save=d=>fs.writeFileSync(DB,JSON.stringify(d,null,1));

/* ================= AUTH ================= */
const SESS=new Map();
const tok=()=>crypto.randomBytes(24).toString('hex');
function me(req){
  const h=req.headers.authorization||'';
  return SESS.get(h.startsWith('Bearer ')?h.slice(7):'')||null;
}

/* ================= HELPERS ================= */
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8',
'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml',
'.ico':'image/x-icon','.json':'application/json;charset=utf-8'};
const J=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
const R=(req,limit=12*1024*1024)=>new Promise((rs,rj)=>{let n=0,ch=[];req.on('data',c=>{n+=c.length;if(n>limit)return rj(new Error('terlalu besar'));ch.push(c);});req.on('end',()=>rs(Buffer.concat(ch)));req.on('error',rj);});
const log=(d,oleh,aksi,detail)=>d.aktivitas.unshift({t:Date.now(),oleh,aksi,detail:detail||''});
function magicOk(b){
  if(!b||b.length<12)return null;
  if(b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47)return 'png';
  if(b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)return 'jpg';
  if(b.slice(0,4).toString()==='RIFF'&&b.slice(8,12).toString()==='WEBP')return 'webp';
  if(b.slice(0,3).toString()==='GIF')return 'gif';
  const s=b.slice(0,300).toString().trim();
  if(s.startsWith('<svg')||s.startsWith('<?xml'))return 'svg';
  return null;
}
function pct(a){ return a.target?Math.min(100,Math.round(a.selesai/a.target*100)):0; }
function syncStatus(a){
  a.selesai=Math.max(0,a.selesai);
  a.status = a.selesai<=0 ? 'Belum Mulai' : (a.target&&a.selesai>=a.target?'Selesai':'Berjalan');
}

/* ================= XLSX (baca & tulis, tanpa dependensi) ================= */
let TBL=null;
function crcTable(){ if(TBL) return TBL; TBL=new Int32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);TBL[n]=c;} return TBL;}
function crc32(buf){const t=crcTable();let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++)c=t[(c^buf[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function unzip(buf){
  let eo=-1;
  for(let i=buf.length-22;i>=0&&i>buf.length-70000;i--){ if(buf.readUInt32LE(i)===0x06054b50){eo=i;break;} }
  if(eo<0) throw new Error('bukan berkas Excel (.xlsx)');
  const count=buf.readUInt16LE(eo+10); let p=buf.readUInt32LE(eo+16); const out={};
  for(let k=0;k<count;k++){
    if(buf.length<p+46||buf.readUInt32LE(p)!==0x02014b50) break;
    const method=buf.readUInt16LE(p+10), csize=buf.readUInt32LE(p+20);
    const nl=buf.readUInt16LE(p+28), el=buf.readUInt16LE(p+30), cl=buf.readUInt16LE(p+32);
    const lho=buf.readUInt32LE(p+42);
    const name=buf.slice(p+46,p+46+nl).toString('utf8');
    const lnl=buf.readUInt16LE(lho+26), lel=buf.readUInt16LE(lho+28);
    const start=lho+30+lnl+lel, data=buf.slice(start,start+csize);
    if(method===0) out[name]=data;
    else { try{ out[name]=zlib.inflateRawSync(data); }catch(e){ try{ out[name]=zlib.inflateSync(data);}catch(e2){} } }
    p+=46+nl+el+cl;
  }
  return out;
}
const un=(s)=>String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const colIdx=(c)=>{let n=0;for(const ch of c)n=n*26+(ch.charCodeAt(0)-64);return n-1;};
function xlsxRows(buf){
  const f=unzip(buf);
  const sheetKey=Object.keys(f).find(n=>/^xl\/worksheets\/sheet1\.xml$/i.test(n))||Object.keys(f).find(n=>/^xl\/worksheets\/.*\.xml$/i.test(n));
  if(!sheetKey) throw new Error('sheet tidak ditemukan');
  let shared=[];
  const sk=Object.keys(f).find(n=>n==='xl/sharedStrings.xml');
  if(sk){ const s=f[sk].toString('utf8');
    shared=[...s.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>un(x[1])).join('')); }
  const sx=f[sheetKey].toString('utf8'), rows=[];
  for(const rm of sx.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)){
    const row=[];
    for(const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)){
      const attrs=cm[2], inner=cm[3]; let v='';
      const vm=inner.match(/<v>([\s\S]*?)<\/v>/);
      if(/t="s"/.test(attrs)) v = vm ? (shared[+vm[1]]||'') : '';
      else if(/t="inlineStr"/.test(attrs)) v=[...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>un(x[1])).join('');
      else v = vm ? un(vm[1]) : '';
      if(v!=='') row[colIdx(cm[1])]=v;
    }
    rows.push(row);
  }
  return rows;
}
function zipMake(files){
  const loc=[],cen=[]; let off=0;
  for(const f of files){
    const name=Buffer.from(f.name,'utf8'), data=f.data, crc=crc32(data), sz=data.length;
    const lh=Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4); lh.writeUInt32LE(crc,14);
    lh.writeUInt32LE(sz,18); lh.writeUInt32LE(sz,22); lh.writeUInt16LE(name.length,26);
    loc.push(lh,name,data);
    const ch=Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6);
    ch.writeUInt32LE(crc,16); ch.writeUInt32LE(sz,20); ch.writeUInt32LE(sz,24);
    ch.writeUInt16LE(name.length,28); ch.writeUInt32LE(off,42);
    cen.push(ch,name);
    off+=30+name.length+sz;
  }
  const cd=Buffer.concat(cen), eo=Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50,0); eo.writeUInt16LE(files.length,8); eo.writeUInt16LE(files.length,10);
  eo.writeUInt32LE(cd.length,12); eo.writeUInt32LE(off,16);
  return Buffer.concat([...loc,cd,eo]);
}
const escX=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function xlsxMake(headers,rows){
  const cell=(v,r,c)=>{
    const ref=String.fromCharCode(65+c)+r;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escX(v==null?'':v)}</t></is></c>`;
  };
  const head=`<row r="1">${headers.map((h,i)=>cell(h,1,i)).join('')}</row>`;
  const body=rows.map((row,i)=>`<row r="${i+2}">${row.map((v,c)=>cell(v,i+2,c)).join('')}</row>`).join('');
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${headers.map((h,i)=>`<col min="${i+1}" max="${i+1}" width="${Math.max(14,Math.min(34,h.length+6))}" customWidth="1"/>`).join('')}</cols><sheetData>${head}${body}</sheetData></worksheet>`;
  return zipMake([
    {name:'[Content_Types].xml',data:Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)},
    {name:'_rels/.rels',data:Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)},
    {name:'xl/workbook.xml',data:Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Mitra" sheetId="1" r:id="rId1"/></sheets></workbook>`)},
    {name:'xl/_rels/workbook.xml.rels',data:Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)},
    {name:'xl/worksheets/sheet1.xml',data:Buffer.from(sheet)}
  ]);
}

/* ================= SERVER ================= */
const server=http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://'+(req.headers.host||'x'));
  const p=u.pathname;
  try{
    /* ---- AUTH ---- */
    if(p==='/api/login'&&req.method==='POST'){
      const j=JSON.parse((await R(req)).toString()||'{}');
      const d=load();
      const us=d.users.find(x=>x.u===String(j.u||'').trim().toLowerCase()&&x.p===j.p);
      if(!us) return J(res,401,{ok:false,msg:'Username atau password salah'});
      const t=tok(); SESS.set(t,{u:us.u,role:us.role,n:us.n,wilayah:us.wilayah||''});
      log(d,us.n,'Masuk aplikasi',us.role); save(d);
      return J(res,200,{ok:true,token:t,user:{u:us.u,role:us.role,n:us.n,wilayah:us.wilayah||''}});
    }
    if(p==='/api/me'){ const m=me(req); return m?J(res,200,{ok:true,user:m}):J(res,401,{ok:false}); }
    if(p==='/api/logout'){ const h=(req.headers.authorization||'').slice(7); SESS.delete(h); return J(res,200,{ok:true}); }

    /* ---- DATA ---- */
    if(p==='/api/data'){
      const m=me(req); const d=load();
      const out={ok:true,meta:d.meta,bidang:d.bidang};
      if(!m){ out.programs=d.programs.filter(x=>x.tahun===d.meta.tahun).map(x=>({id:x.id,nama:x.nama,bidang:x.bidang,tahun:x.tahun,status:x.status})); return J(res,200,out); }
      if(m.role==='mitra'){
        out.programs=d.programs.filter(x=>x.tahun===d.meta.tahun);
        out.assignments=d.assignments.filter(a=>a.mitraU===m.u);
        out.laporan=d.laporan.filter(l=>l.mitraU===m.u).slice(0,80);
        out.foto=d.foto.filter(f=>f.mitraU===m.u).slice(0,120);
        out.aktivitas=d.aktivitas.filter(a=>a.oleh===m.n).slice(0,20);
      }else{
        out.programs=d.programs; out.assignments=d.assignments; out.laporan=d.laporan.slice(0,200);
        out.foto=d.foto.slice(0,300); out.aktivitas=d.aktivitas.slice(0,40);
        out.users=d.users.map(x=>({u:x.u,n:x.n,role:x.role,wilayah:x.wilayah||'',hp:x.hp||'',email:x.email||''}));
      }
      return J(res,200,out);
    }

    /* ---- PROGRAM ---- */
    if(p==='/api/program'&&req.method==='POST'){
      const m=me(req); if(!m||m.role==='mitra') return J(res,403,{ok:false,msg:'Akses ditolak'});
      const j=JSON.parse((await R(req)).toString()); const d=load();
      if(j.del){
        if(m.role!=='superadmin') return J(res,403,{ok:false,msg:'Hanya superadmin dapat menghapus program'});
        d.programs=d.programs.filter(x=>x.id!==j.del);
        d.assignments=d.assignments.filter(a=>a.programId!==j.del);
        d.laporan=d.laporan.filter(l=>l.programId!==j.del);
        log(d,m.n,'Hapus program',j.del); save(d); return J(res,200,{ok:true});
      }
      if(j.id){
        const pr=d.programs.find(x=>x.id===j.id); if(!pr) return J(res,404,{ok:false});
        if(m.role==='admin'){
          pr.status=j.status??pr.status; pr.catatanAdmin=j.catatanAdmin??pr.catatanAdmin;
        }else{
          Object.assign(pr,{nama:j.nama??pr.nama,bidang:j.bidang??pr.bidang,tahun:+(j.tahun??pr.tahun),
            target:+(j.target??pr.target),unit:j.unit??pr.unit,deskripsi:j.deskripsi??pr.deskripsi,
            mulai:j.mulai??pr.mulai,deadline:j.deadline??pr.deadline,status:j.status??pr.status,
            wajibFoto:j.wajibFoto!==undefined?!!j.wajibFoto:pr.wajibFoto,
            fields:Array.isArray(j.fields)?j.fields:pr.fields});
        }
        log(d,m.n,'Perbarui program',pr.nama); save(d); return J(res,200,{ok:true,program:pr});
      }
      if(m.role!=='superadmin') return J(res,403,{ok:false,msg:'Hanya superadmin dapat menambah program'});
      if(!j.nama) return J(res,400,{ok:false,msg:'Nama program wajib diisi'});
      const n={id:'PRG-'+String(d.programs.length+1).padStart(3,'0'),nama:j.nama,bidang:j.bidang||'tp',
        tahun:+(j.tahun||d.meta.tahun),target:+(j.target||0),unit:j.unit||'sampel/BS',
        deskripsi:j.deskripsi||'',mulai:j.mulai||'',deadline:j.deadline||'',
        status:j.status||'Berjalan',wajibFoto:j.wajibFoto!==false,
        fields:Array.isArray(j.fields)&&j.fields.length?j.fields:[{key:'jumlah',label:'Jumlah selesai',tipe:'number',wajib:true}]};
      d.programs.push(n); log(d,m.n,'Tambah program',n.nama); save(d);
      return J(res,200,{ok:true,program:n});
    }

    /* ---- PENUGASAN ---- */
    if(p==='/api/assign'&&req.method==='POST'){
      const m=me(req); if(!m||m.role==='mitra') return J(res,403,{ok:false});
      const j=JSON.parse((await R(req)).toString()); const d=load();
      if(j.del){ d.assignments=d.assignments.filter(a=>a.id!==j.del); save(d); return J(res,200,{ok:true}); }
      const pr=d.programs.find(x=>x.id===j.programId);
      if(!pr) return J(res,404,{ok:false,msg:'Program tidak ditemukan'});
      let a=d.assignments.find(x=>x.programId===j.programId&&x.mitraU===j.mitraU);
      if(a){ a.target=+(j.target??a.target); syncStatus(a); a.updatedAt=Date.now(); }
      else{ a={id:'ASG-'+String(d.assignments.length+1).padStart(4,'0'),programId:j.programId,mitraU:j.mitraU,
        target:+(j.target||0),selesai:0,status:'Belum Mulai',updatedAt:Date.now()}; d.assignments.push(a); }
      const mu=d.users.find(x=>x.u===j.mitraU);
      log(d,m.n,'Tugaskan mitra',(mu?mu.n:j.mitraU)+' → '+pr.nama); save(d);
      return J(res,200,{ok:true,assignment:a});
    }

    /* ---- LAPORAN ---- */
    if(p==='/api/laporan'&&req.method==='POST'){
      const m=me(req); if(!m) return J(res,401,{ok:false});
      const j=JSON.parse((await R(req)).toString()); const d=load();
      if(j.verify){
        if(m.role==='mitra') return J(res,403,{ok:false});
        const l=d.laporan.find(x=>x.id===j.verify); if(!l) return J(res,404,{ok:false});
        l.verified=!!j.verified; l.verifiedBy=m.n; l.verifiedAt=Date.now();
        log(d,m.n,j.verified?'Verifikasi laporan':'Tolak laporan',l.id); save(d); return J(res,200,{ok:true});
      }
      if(j.del){ const l=d.laporan.find(x=>x.id===j.del); if(!l) return J(res,404,{ok:false});
        if(m.role==='mitra'&&l.mitraU!==m.u) return J(res,403,{ok:false});
        d.laporan=d.laporan.filter(x=>x.id!==j.del);
        const a=d.assignments.find(x=>x.programId===l.programId&&x.mitraU===l.mitraU);
        if(a){ a.selesai=Math.max(0,d.laporan.filter(x=>x.programId===l.programId&&x.mitraU===l.mitraU).reduce((s,x)=>s+ +x.jumlah,0)); syncStatus(a); }
        log(d,m.n,'Hapus laporan',l.id); save(d); return J(res,200,{ok:true}); }
      const mitraU = m.role==='mitra' ? m.u : (j.mitraU||m.u);
      const pr=d.programs.find(x=>x.id===j.programId);
      if(!pr) return J(res,404,{ok:false,msg:'Program tidak ada'});
      const jml=+(j.jumlah||0);
      if(!(jml>0)) return J(res,400,{ok:false,msg:'Jumlah selesai harus lebih dari 0'});
      const mitraN=(d.users.find(x=>x.u===mitraU)||{}).n||mitraU;
      let a=d.assignments.find(x=>x.programId===j.programId&&x.mitraU===mitraU);
      if(!a){ a={id:'ASG-'+String(d.assignments.length+1).padStart(4,'0'),programId:j.programId,mitraU,
        target:+(j.target||pr.target||0),selesai:0,status:'Belum Mulai',updatedAt:Date.now()}; d.assignments.push(a); }
      const lap={id:'LPR-'+String(d.laporan.length+1).padStart(4,'0'),programId:pr.id,mitraU,mitraN,
        jumlah:jml,catatan:j.catatan||'',tgl:j.tgl||new Date().toISOString().slice(0,10),
        foto:Array.isArray(j.foto)?j.foto:[],t:Date.now(),verified:m.role!=='mitra',verifiedBy:m.role!=='mitra'?m.n:'',verifiedAt:m.role!=='mitra'?Date.now():0};
      d.laporan.unshift(lap);
      a.selesai=d.laporan.filter(x=>x.programId===pr.id&&x.mitraU===mitraU).reduce((s,x)=>s+ +x.jumlah,0);
      syncStatus(a); a.updatedAt=Date.now();
      log(d,m.n,'Kirim laporan',pr.nama+' · '+jml+' '+pr.unit); save(d);
      return J(res,200,{ok:true,laporan:lap,assignment:a});
    }

    /* ---- UPLOAD FOTO (per mitra) ---- */
    if(p==='/api/upload'&&req.method==='POST'){
      const m=me(req); if(!m) return J(res,401,{ok:false});
      const buf=await R(req); const ext=magicOk(buf);
      if(!ext) return J(res,400,{ok:false,msg:'Hanya gambar PNG/JPG/WEBP/GIF/SVG'});
      if(buf.length>5*1024*1024) return J(res,400,{ok:false,msg:'Maksimal 5 MB'});
      const dnow=load();
      const mitraU = m.role==='mitra' ? m.u : (u.searchParams.get('mitraU')||m.u);
      const mitraN=((dnow.users.find(x=>x.u===mitraU)||{}).n)||m.n;
      const slug=mitraU.replace(/[^a-z0-9]/gi,'');
      const file='foto_'+slug+'_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex')+'.'+ext;
      fs.writeFileSync(path.join(UPL,file),buf);
      const d=load();
      const meta={file,judul:u.searchParams.get('judul')||'Dokumentasi kegiatan',
        programId:u.searchParams.get('programId')||'',mitraU,mitraN,oleh:m.n,role:m.role,t:Date.now(),size:buf.length};
      d.foto.unshift(meta); log(d,m.n,'Unggah foto',meta.judul+' · '+mitraN); save(d);
      return J(res,200,{ok:true,foto:meta,url:'/uploads/'+file});
    }
    if(p==='/api/foto/delete'&&req.method==='POST'){
      const m=me(req); if(!m) return J(res,401,{ok:false});
      const j=JSON.parse((await R(req)).toString()); const d=load();
      const f=d.foto.find(x=>x.file===j.file); if(!f) return J(res,404,{ok:false});
      if(m.role==='mitra'&&f.mitraU!==m.u) return J(res,403,{ok:false,msg:'Bukan foto Anda'});
      try{fs.unlinkSync(path.join(UPL,f.file));}catch(e){}
      d.foto=d.foto.filter(x=>x.file!==j.file); log(d,m.n,'Hapus foto',f.judul); save(d);
      return J(res,200,{ok:true});
    }

    /* ---- PENGGUNA ---- */
    if(p==='/api/users'&&req.method==='POST'){
      const m=me(req); if(!m||m.role==='mitra') return J(res,403,{ok:false});
      const j=JSON.parse((await R(req)).toString()); const d=load();
      if(j.del){ const target=d.users.find(x=>x.u===j.del);
        if(!target) return J(res,404,{ok:false});
        if(target.role==='superadmin') return J(res,403,{ok:false,msg:'Akun superadmin tidak bisa dihapus'});
        if(m.role==='admin'&&target.role==='admin') return J(res,403,{ok:false,msg:'Hanya superadmin dapat menghapus admin'});
        d.users=d.users.filter(x=>x.u!==j.del);
        d.assignments=d.assignments.filter(a=>a.mitraU!==j.del);
        log(d,m.n,'Hapus pengguna',j.del); save(d); return J(res,200,{ok:true}); }
      const uu=String(j.u||'').trim().toLowerCase();
      if(!uu||!j.p) return J(res,400,{ok:false,msg:'Username dan password wajib diisi'});
      if(d.users.some(x=>x.u===uu)) return J(res,400,{ok:false,msg:'Username sudah dipakai'});
      const role=j.role==='admin'?'admin':'mitra';
      if(role==='admin'&&m.role!=='superadmin') return J(res,403,{ok:false,msg:'Hanya superadmin dapat menambah admin'});
      d.users.push({u:uu,p:j.p,role,n:j.n||uu,wilayah:j.wilayah||'',hp:j.hp||'',email:j.email||''});
      log(d,m.n,'Tambah pengguna',(j.n||uu)+' ('+role+')'); save(d);
      return J(res,200,{ok:true});
    }

    /* ---- IMPORT EXCEL MITRA ---- */
    if(p==='/api/import'&&req.method==='POST'){
      const m=me(req); if(!m||m.role==='mitra') return J(res,403,{ok:false});
      const buf=await R(req);
      let rows;
      const isZip=buf.length>4&&buf.readUInt32LE(0)===0x04034b50;
      try{
        if(isZip) rows=xlsxRows(buf);
        else rows=buf.toString('utf8').split(/\r?\n/).filter(l=>l.trim()).map(l=>l.split(/[;,\t]/).map(c=>c.trim().replace(/^"|"$/g,'')));
      }catch(e){ return J(res,400,{ok:false,msg:'Berkas tidak dikenali: '+e.message}); }
      if(!rows.length) return J(res,400,{ok:false,msg:'Berkas kosong'});
      const hdr=(rows[0]||[]).map(h=>String(h||'').toLowerCase().trim());
      const find=(names)=>hdr.findIndex(h=>names.some(n=>h===n||h.includes(n)));
      const iNama=find(['nama','nama lengkap']), iU=find(['username','user']), iP=find(['password','sandi']),
            iW=find(['wilayah','kecamatan','desa']), iHp=find(['hp','telepon','telp','wa']), iE=find(['email']),
            iPrg=find(['program','survei']), iTgt=find(['target']);
      if(iNama<0||iU<0) return J(res,400,{ok:false,msg:'Kolom Nama dan Username wajib ada di baris pertama'});
      const d=load(); let baru=0,gagal=0,tugas=0; const pesan=[];
      for(let r=1;r<rows.length;r++){
        const row=rows[r]||[];
        const nama=String(row[iNama]||'').trim(); let uname=String(row[iU]||'').trim().toLowerCase();
        if(!nama&&!uname) continue;
        if(!uname) uname=nama.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'');
        if(!nama){ gagal++; pesan.push('Baris '+(r+1)+': nama kosong'); continue; }
        if(!uname){ gagal++; continue; }
        const pw=String(row[iP]||'').trim()||'mitra3305';
        let us=d.users.find(x=>x.u===uname);
        if(!us){
          d.users.push({u:uname,p:pw,role:'mitra',n:nama,wilayah:String(row[iW]||'').trim(),
            hp:String(row[iHp]||'').trim(),email:String(row[iE]||'').trim()});
          us=d.users[d.users.length-1]; baru++;
        }
        const pname=iPrg>=0?String(row[iPrg]||'').trim():'';
        if(pname){
          const prg=d.programs.find(x=>x.id===pname)||d.programs.find(x=>x.nama.toLowerCase()===pname.toLowerCase())
            ||d.programs.find(x=>x.nama.toLowerCase().includes(pname.toLowerCase()));
          if(prg){
            const target=iTgt>=0?+(row[iTgt]||0):0;
            let a=d.assignments.find(x=>x.programId===prg.id&&x.mitraU===us.u);
            if(a){ if(target>0){a.target=target;syncStatus(a);} tugas++; }
            else{ d.assignments.push({id:'ASG-'+String(d.assignments.length+1).padStart(4,'0'),programId:prg.id,
              mitraU:us.u,target:target>0?target:Math.round(prg.target/Math.max(1,d.users.filter(x=>x.role==='mitra').length)),
              selesai:0,status:'Belum Mulai',updatedAt:Date.now()}); tugas++; }
          } else { pesan.push('Baris '+(r+1)+': program "'+pname+'" tidak ditemukan — mitra tetap ditambahkan'); }
        }
      }
      log(d,m.n,'Impor mitra',baru+' baru · '+tugas+' penugasan'); save(d);
      return J(res,200,{ok:true,baru,gagal,tugas,pesan:pesan.slice(0,12)});
    }
    if(p==='/api/template.xlsx'){
      const m=me(req); if(!m||m.role==='mitra') return J(res,403,{ok:false});
      const d=load();
      const buf=xlsxMake(
        ['Nama','Username','Password','Wilayah','NoHP','Email','Program','Target'],
        [['Contoh: Ahmad Fauzi','mitra7','mitra3305','Kebumen','081234567890','ahmad@contoh.id',d.programs[0]?d.programs[0].nama:'',60]]
      );
      res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':'attachment; filename="template-impor-mitra.xlsx"'});
      return res.end(buf);
    }

    /* ---- META ---- */
    if(p==='/api/meta'&&req.method==='POST'){
      const m=me(req); if(!m||m.role==='mitra') return J(res,403,{ok:false});
      const j=JSON.parse((await R(req)).toString()); const d=load();
      d.meta.instansi=j.instansi??d.meta.instansi; d.meta.unit=j.unit??d.meta.unit; d.meta.tahun=+(j.tahun??d.meta.tahun);
      log(d,m.n,'Ubah pengaturan',''); save(d); return J(res,200,{ok:true,meta:d.meta});
    }

    /* ---- EXPORT ---- */
    if(p==='/api/export'){
      const m=me(req); if(!m) return J(res,401,{ok:false});
      const d=load(); const rows=[['Mitra','Wilayah','Program','Bidang','Target','Selesai','Persen','Status']];
      for(const a of d.assignments){
        const mu=d.users.find(x=>x.u===a.mitraU)||{}, pr=d.programs.find(x=>x.id===a.programId)||{};
        const b=d.bidang.find(x=>x.id===pr.bidang)||{};
        rows.push([mu.n||a.mitraU,mu.wilayah||'',pr.nama||'',b.nama||'',a.target,a.selesai,pct(a)+'%',a.status]);
      }
      if(m.role==='mitra'){ const own=rows.filter((r,i)=>i===0||r[0]===m.n);
        return csvOut(res,own,'rekap-'+m.u+'.csv'); }
      return csvOut(res,rows,'rekap-monitoring-3305.csv');
    }

    /* ---- STATIC ---- */
    if(p.startsWith('/uploads/')){
      const f=path.join(UPL,path.basename(p));
      if(fs.existsSync(f)){ res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'public,max-age=86400'}); return res.end(fs.readFileSync(f)); }
      return J(res,404,{ok:false});
    }
    let f=path.join(PUB,p==='/'?'index.html':p);
    if(!fs.existsSync(f)||fs.statSync(f).isDirectory()) f=path.join(PUB,'index.html');
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/html;charset=utf-8','Cache-Control':'no-cache'});
    return res.end(fs.readFileSync(f));
  }catch(e){ try{J(res,500,{ok:false,msg:e.message});}catch(_){} }
});
function csvOut(res,rows,name){
  const csv=rows.map(r=>r.map(c=>'"'+String(c==null?'':c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  res.writeHead(200,{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment;filename="'+name+'"'});
  return res.end('\uFEFF'+csv);
}
server.listen(PORT,()=>{ load(); console.log('Dashboard BPS 3305 → http://localhost:'+PORT); });
