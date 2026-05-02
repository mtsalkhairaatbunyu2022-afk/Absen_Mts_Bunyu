/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Plus, 
  Search, 
  GraduationCap,
  Bell,
  Settings,
  ChevronRight,
  MoreVertical,
  Trash2,
  Edit,
  AlertCircle,
  ClipboardCheck,
  BarChart3,
  Filter,
  Download,
  RotateCcw,
  Save,
  FileUp,
  FileSpreadsheet,
  FileText,
  XCircle
} from 'lucide-react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc, 
  query, 
  orderBy,
  serverTimestamp,
  getDocFromServer,
  writeBatch,
  getDocs,
  where
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { db, auth } from './firebase';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType } from 'docx';
import mammoth from 'mammoth';

// --- Types ---
interface Student {
  id: string;
  name: string;
  nis: string;
  class: string;
  email?: string;
  status: 'active' | 'inactive';
}

interface Attendance {
  id: string;
  studentId: string;
  date: string;
  status: 'H' | 'A' | 'I' | 'S';
  remarks?: string;
}

interface Grade {
  id: string;
  studentId: string;
  subject: string;
  gradeLevel: string;
  dailyGrades: number[]; // 1-10
  testGrades: number[]; // 1-10
  practicalGrades: number[]; // 1-5
  date: string;
}

const SUBJECTS = [
  { name: 'Bahasa Arab', levels: ['7', '8', '9'] },
  { name: 'Qawaid', levels: ['7', '8', '9'] },
  { name: 'Informatika', levels: ['7', '8', '9'] }
];

// --- Components ---

const SidebarItem = ({ 
  icon: Icon, 
  label, 
  active, 
  onClick 
}: { 
  icon: any, 
  label: string, 
  active: boolean, 
  onClick: () => void 
}) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200 group",
      active 
        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" 
        : "text-slate-500 hover:bg-indigo-50 hover:text-indigo-600"
    )}
  >
    <Icon size={20} className={cn("transition-transform group-hover:scale-110", active ? "text-white" : "text-slate-400 group-hover:text-indigo-600")} />
    <span className="font-medium">{label}</span>
  </button>
);

const Card = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden", className)}>
    {children}
  </div>
);

export default function App() {
  const [isDashboard, setIsDashboard] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'class-7' | 'class-8' | 'class-9' | 'settings'>('dashboard');
  const [subTab, setSubTab] = useState<'attendance' | 'grades' | 'attendance-rekap-bulanan' | 'attendance-rekap-semester'>('attendance');
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [appLogo, setAppLogo] = useState<string | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);

  // Handle window resize for sidebar
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Filters
  const [selectedClass, setSelectedClass] = useState<string>('All'); 
  const [selectedGradeLevel, setSelectedGradeLevel] = useState<string>('7');
  const [selectedSubject, setSelectedSubject] = useState<string>('Bahasa Arab');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [newStudent, setNewStudent] = useState({ name: '', class: '9' });
  const [importLoading, setImportLoading] = useState(false);
  const [pendingStudents, setPendingStudents] = useState<{name: string, class: string}[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const [pendingAttendance, setPendingAttendance] = useState<Record<string, string>>({});
  const [pendingGrades, setPendingGrades] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setPendingAttendance({});
    setPendingGrades({});
  }, [selectedDate, selectedSubject, selectedGradeLevel, activeTab]);

  const handleSaveAttendance = async () => {
    if (Object.keys(pendingAttendance).length === 0) {
      setToast({ message: "Tidak ada perubahan untuk disimpan.", type: 'error' });
      return;
    }
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      for (const [studentId, status] of Object.entries(pendingAttendance)) {
        const existingRecord = attendance.find(a => a.studentId === studentId && a.date === selectedDate);
        if (existingRecord) {
          if (status === 'NONE') {
            batch.delete(doc(db, 'attendance', existingRecord.id));
          } else {
            batch.update(doc(db, 'attendance', existingRecord.id), { status });
          }
        } else if (status !== 'NONE') {
          const newDoc = doc(collection(db, 'attendance'));
          batch.set(newDoc, {
            studentId,
            date: selectedDate,
            status,
            createdAt: serverTimestamp()
          });
        }
      }
      await batch.commit();
      setPendingAttendance({});
      setToast({ message: "Absensi berhasil disimpan!", type: 'success' });
    } catch (err) {
      console.error("Save attendance error:", err);
      setToast({ message: "Gagal menyimpan absensi.", type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveGrades = async () => {
    if (Object.keys(pendingGrades).length === 0) {
      setToast({ message: "Tidak ada perubahan untuk disimpan.", type: 'error' });
      return;
    }
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      for (const [studentId, data] of Object.entries(pendingGrades)) {
        const existingGrade = grades.find(g => g.studentId === studentId && g.subject === selectedSubject && g.gradeLevel === selectedGradeLevel);
        if (existingGrade) {
          batch.update(doc(db, 'grades', existingGrade.id), data);
        } else {
          const newDoc = doc(collection(db, 'grades'));
          batch.set(newDoc, {
            studentId,
            subject: selectedSubject,
            gradeLevel: selectedGradeLevel,
            date: selectedDate,
            createdAt: serverTimestamp(),
            ...(data as object)
          });
        }
      }
      await batch.commit();
      setPendingGrades({});
      setToast({ message: "Nilai berhasil disimpan!", type: 'success' });
    } catch (err) {
      console.error("Save grades error:", err);
      setToast({ message: "Gagal menyimpan nilai.", type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const normalizeClass = (val: any): string => {
    const s = String(val).toUpperCase().replace('KELAS ', '').trim();
    if (s === 'VII' || s === '7') return '7';
    if (s === 'VIII' || s === '8') return '8';
    if (s === 'IX' || s === '9') return '9';
    return s;
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const parsed: {name: string, class: string}[] = [];
        data.forEach((row: any) => {
          const rowKeys = Object.keys(row);
          const findKey = (possible: string[]) => rowKeys.find(rk => possible.includes(rk.toLowerCase()));
          
          const nameKey = findKey(['nama', 'name', 'nomor', 'nama siswa', 'student name']);
          const classKey = findKey(['kelas', 'class', 'grade']);
          
          const name = nameKey ? row[nameKey] : null;
          const className = classKey ? row[classKey] : selectedClass;
          
          if (name) {
            parsed.push({
              name: String(name),
              class: normalizeClass(className)
            });
          }
        });

        if (parsed.length > 0) {
          setPendingStudents(parsed);
          setShowPreview(true);
        } else {
          setToast({ message: "Data tidak ditemukan. Pastikan kolom bernama 'Nomor' atau 'Nama' dan 'Kelas'.", type: 'error' });
        }
      };
      reader.readAsBinaryString(file);
    } catch (err) {
      console.error("Import Excel error:", err);
      setToast({ message: "Gagal membaca file Excel.", type: 'error' });
    } finally {
      setImportLoading(false);
      e.target.value = '';
    }
  };

  const handleImportWord = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;
      const lines = text.split('\n').filter(line => line.trim() !== '');
      
      const parsed: {name: string, class: string}[] = [];

      lines.forEach((line) => {
        const parts = line.split(/[,;\t]/).map(p => p.trim());
        if (parts.length >= 1) {
          const name = parts[0];
          const className = parts[1] || selectedClass;

          if (name && name.length > 1) {
            parsed.push({
              name,
              class: normalizeClass(className)
            });
          }
        }
      });

      if (parsed.length > 0) {
        setPendingStudents(parsed);
        setShowPreview(true);
      } else {
        setToast({ message: "Format tidak sesuai. Gunakan format: Nama, Kelas", type: 'error' });
      }
    } catch (err) {
      console.error("Import Word error:", err);
      setToast({ message: "Gagal membaca file Word.", type: 'error' });
    } finally {
      setImportLoading(false);
      e.target.value = '';
    }
  };

  const confirmImport = async () => {
    setImportLoading(true);
    try {
      const batch = writeBatch(db);
      pendingStudents.forEach((student) => {
        const newDoc = doc(collection(db, 'students'));
        batch.set(newDoc, {
          ...student,
          nis: '-',
          status: 'active',
          createdAt: serverTimestamp()
        });
      });
      await batch.commit();
      setToast({ message: `Berhasil menyimpan ${pendingStudents.length} siswa!`, type: 'success' });
      setPendingStudents([]);
      setShowPreview(false);
      setIsAddModalOpen(false);
    } catch (err) {
      console.error("Confirm import error:", err);
      setToast({ message: "Gagal menyimpan data ke database.", type: 'error' });
    } finally {
      setImportLoading(false);
    }
  };

  const handleDeleteStudent = async () => {
    if (!deletingStudentId) return;
    setImportLoading(true);
    try {
      const id = deletingStudentId;
      await deleteDoc(doc(db, 'students', id));
      
      // Cleanup related data
      const attendanceQ = query(collection(db, 'attendance'), where('studentId', '==', id));
      const gradesQ = query(collection(db, 'grades'), where('studentId', '==', id));
      
      const [attendanceSnap, gradesSnap] = await Promise.all([
        getDocs(attendanceQ),
        getDocs(gradesQ)
      ]);

      const batch = writeBatch(db);
      attendanceSnap.docs.forEach(d => batch.delete(d.ref));
      gradesSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      setToast({ message: "Siswa berhasil dihapus!", type: 'success' });
      setIsDeleteModalOpen(false);
      setDeletingStudentId(null);
    } catch (err) {
      console.error("Delete student error:", err);
      setToast({ message: "Gagal menghapus siswa.", type: 'error' });
    } finally {
      setImportLoading(false);
    }
  };

  const handleUpdateStudent = async () => {
    if (!editingStudent || !editingStudent.name || !editingStudent.class) {
      setToast({ message: "Mohon lengkapi data!", type: 'error' });
      return;
    }
    try {
      await updateDoc(doc(db, 'students', editingStudent.id), {
        name: editingStudent.name,
        class: normalizeClass(editingStudent.class)
      });
      setToast({ message: "Data siswa berhasil diperbarui!", type: 'success' });
      setIsEditModalOpen(false);
      setEditingStudent(null);
    } catch (err) {
      console.error("Update student error:", err);
      setToast({ message: "Gagal memperbarui data siswa.", type: 'error' });
    }
  };

  // Data Listeners
  useEffect(() => {
    setLoading(true);
    
    const qStudents = query(collection(db, 'students'), orderBy('name'));
    const unsubStudents = onSnapshot(qStudents, (snapshot) => {
      setStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student)));
      setLoading(false);
    }, (err) => {
      console.error("Students error:", err);
      setLoading(false);
    });

    const qAttendance = query(collection(db, 'attendance'), orderBy('date', 'desc'));
    const unsubAttendance = onSnapshot(qAttendance, (snapshot) => {
      setAttendance(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Attendance)));
    }, (err) => console.error("Attendance error:", err));

    const qGrades = query(collection(db, 'grades'), orderBy('date', 'desc'));
    const unsubGrades = onSnapshot(qGrades, (snapshot) => {
      setGrades(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Grade)));
    }, (err) => console.error("Grades error:", err));

    const qSettings = query(collection(db, 'appSettings'));
    const unsubSettings = onSnapshot(qSettings, (snapshot) => {
      if (!snapshot.empty) {
        const docSettings = snapshot.docs[0];
        setSettingsId(docSettings.id);
        const data = docSettings.data();
        const logo = data.logoUrl || null;
        setAppLogo(logo);
        
        // Dynamic update for browser icons
        if (logo) {
          const favicon = document.getElementById('dynamic-favicon') as HTMLLinkElement;
          const appleIcon = document.getElementById('dynamic-apple-icon') as HTMLLinkElement;
          if (favicon) favicon.href = logo;
          if (appleIcon) appleIcon.href = logo;

          // Advanced: Dynamic Manifest for PWA Install Icon
          const manifest = {
            "name": "MTs Al-Khairaat Bunyu",
            "short_name": "MTs Bunyu",
            "start_url": ".",
            "display": "standalone",
            "background_color": "#ffffff",
            "theme_color": "#4f46e5",
            "icons": [
              { "src": logo, "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
              { "src": logo, "sizes": "512x512", "type": "image/png" }
            ]
          };
          const stringManifest = JSON.stringify(manifest);
          const blob = new Blob([stringManifest], {type: 'application/json'});
          const manifestURL = URL.createObjectURL(blob);
          const manifestTag = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
          if (manifestTag) manifestTag.href = manifestURL;
        }
      }
    }, (err) => console.error("Settings error:", err));

    return () => {
      unsubStudents();
      unsubAttendance();
      unsubGrades();
      unsubSettings();
    };
  }, []);

  const handleExportExcel = (type: 'attendance' | 'grades') => {
    let data: any[] = [];
    if (type === 'attendance') {
      const class9Students = students.filter(s => s.class === '9');
      data = class9Students.map((s, i) => {
        const record = attendance.find(a => a.studentId === s.id && a.date === selectedDate);
        const studentRecords = attendance.filter(a => a.studentId === s.id);
        return {
          'No': i + 1,
          'Nama': s.name,
          'Keterangan Hari Ini': record?.status || '-',
          'Hadir (H)': studentRecords.filter(r => r.status === 'H').length,
          'Alpa (A)': studentRecords.filter(r => r.status === 'A').length,
          'Izin (I)': studentRecords.filter(r => r.status === 'I').length,
          'Sakit (S)': studentRecords.filter(r => r.status === 'S').length,
          'Total Hari': studentRecords.length
        };
      });
    } else {
      const filteredGrades = grades.filter(g => g.subject === selectedSubject && g.gradeLevel === selectedGradeLevel);
      data = students
        .filter(s => s.class === selectedGradeLevel)
        .map((s, i) => {
          const g = filteredGrades.find(grade => grade.studentId === s.id);
          const row: any = { 'No': i + 1, 'Nama': s.name };
          for (let j = 0; j < 10; j++) row[`Harian ${j + 1}`] = g?.dailyGrades?.[j] || 0;
          for (let j = 0; j < 10; j++) row[`Ulangan ${j + 1}`] = g?.testGrades?.[j] || 0;
          for (let j = 0; j < 5; j++) row[`Praktek ${j + 1}`] = g?.practicalGrades?.[j] || 0;
          
          const allGrades = [...(g?.dailyGrades || []), ...(g?.testGrades || []), ...(g?.practicalGrades || [])];
          const gradedValues = allGrades.filter(v => v > 0);
          row['Rata-rata'] = gradedValues.length > 0 
            ? (gradedValues.reduce((a, b) => a + b, 0) / gradedValues.length).toFixed(1) 
            : '-';
          
          return row;
        });
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type);
    XLSX.writeFile(wb, `${type}_${selectedDate}.xlsx`);
  };

  const handleExportWord = async (type: 'attendance' | 'grades') => {
    const rows = [];
    if (type === 'attendance') {
      const class9Students = students.filter(s => s.class === '9');
      rows.push(new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("No")] }),
          new TableCell({ children: [new Paragraph("Nama")] }),
          new TableCell({ children: [new Paragraph("Ket. Hari Ini")] }),
          new TableCell({ children: [new Paragraph("H")] }),
          new TableCell({ children: [new Paragraph("A")] }),
          new TableCell({ children: [new Paragraph("I")] }),
          new TableCell({ children: [new Paragraph("S")] }),
          new TableCell({ children: [new Paragraph("Total")] }),
        ],
      }));
      class9Students.forEach((s, i) => {
        const record = attendance.find(a => a.studentId === s.id && a.date === selectedDate);
        const studentRecords = attendance.filter(a => a.studentId === s.id);
        rows.push(new TableRow({
          children: [
            new TableCell({ children: [new Paragraph((i + 1).toString())] }),
            new TableCell({ children: [new Paragraph(s.name)] }),
            new TableCell({ children: [new Paragraph(record?.status || "-")] }),
            new TableCell({ children: [new Paragraph(studentRecords.filter(r => r.status === 'H').length.toString())] }),
            new TableCell({ children: [new Paragraph(studentRecords.filter(r => r.status === 'A').length.toString())] }),
            new TableCell({ children: [new Paragraph(studentRecords.filter(r => r.status === 'I').length.toString())] }),
            new TableCell({ children: [new Paragraph(studentRecords.filter(r => r.status === 'S').length.toString())] }),
            new TableCell({ children: [new Paragraph(studentRecords.length.toString())] }),
          ],
        }));
      });
    } else {
      const headerCells = [
        new TableCell({ children: [new Paragraph("No")] }),
        new TableCell({ children: [new Paragraph("Nama")] }),
      ];
      for (let j = 1; j <= 10; j++) headerCells.push(new TableCell({ children: [new Paragraph(`H${j}`)] }));
      for (let j = 1; j <= 10; j++) headerCells.push(new TableCell({ children: [new Paragraph(`U${j}`)] }));
      for (let j = 1; j <= 5; j++) headerCells.push(new TableCell({ children: [new Paragraph(`P${j}`)] }));
      headerCells.push(new TableCell({ children: [new Paragraph("Rata2")] }));

      rows.push(new TableRow({ children: headerCells }));

      const filteredGrades = grades.filter(g => g.subject === selectedSubject && g.gradeLevel === selectedGradeLevel);
      students.filter(s => s.class === selectedGradeLevel).forEach((s, i) => {
        const g = filteredGrades.find(grade => grade.studentId === s.id);
        const cells = [
          new TableCell({ children: [new Paragraph((i + 1).toString())] }),
          new TableCell({ children: [new Paragraph(s.name)] }),
        ];
        for (let j = 0; j < 10; j++) cells.push(new TableCell({ children: [new Paragraph((g?.dailyGrades?.[j] || 0).toString())] }));
        for (let j = 0; j < 10; j++) cells.push(new TableCell({ children: [new Paragraph((g?.testGrades?.[j] || 0).toString())] }));
        for (let j = 0; j < 5; j++) cells.push(new TableCell({ children: [new Paragraph((g?.practicalGrades?.[j] || 0).toString())] }));
        
        const allGrades = [...(g?.dailyGrades || []), ...(g?.testGrades || []), ...(g?.practicalGrades || [])];
        const gradedValues = allGrades.filter(v => v > 0);
        const avg = gradedValues.length > 0 
          ? (gradedValues.reduce((a, b) => a + b, 0) / gradedValues.length).toFixed(1) 
          : '-';
        cells.push(new TableCell({ children: [new Paragraph(avg)] }));
        
        rows.push(new TableRow({ children: cells }));
      });
    }

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: `${type.toUpperCase()} - ${selectedDate}`, heading: "Heading1" }),
          new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${type}_${selectedDate}.docx`);
  };

  const handleReset = async (type: 'attendance' | 'grades') => {
    // Using a simple toast for confirmation or just proceeding for now as per instructions to avoid window.confirm
    // In a real app, I'd use a custom modal.
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      if (type === 'attendance') {
        const q = query(collection(db, 'attendance'), where('date', '==', selectedDate));
        const snapshot = await getDocs(q);
        snapshot.docs.forEach(d => batch.delete(d.ref));
        setPendingAttendance({});
      } else {
        const q = query(collection(db, 'grades'), 
          where('subject', '==', selectedSubject), 
          where('gradeLevel', '==', selectedGradeLevel)
        );
        const snapshot = await getDocs(q);
        snapshot.docs.forEach(d => batch.delete(d.ref));
        setPendingGrades({});
      }
      await batch.commit();
      setToast({ message: `Data ${type === 'attendance' ? 'absensi' : 'nilai'} berhasil direset!`, type: 'success' });
    } catch (err) {
      console.error("Reset error:", err);
      setToast({ message: "Gagal mereset data.", type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isDashboard) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Background Decorative Elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 md:p-12 rounded-[2rem] md:rounded-[3rem] shadow-2xl shadow-indigo-100 border border-slate-100 max-w-lg w-full text-center relative"
        >
          <div className="mb-6 md:mb-8 relative">
            <div className="w-24 h-24 md:w-32 md:h-32 bg-indigo-600 rounded-[2rem] md:rounded-[2.5rem] flex items-center justify-center mx-auto shadow-xl shadow-indigo-200 rotate-12 hover:rotate-0 transition-transform duration-500 overflow-hidden">
              {appLogo ? (
                <img src={appLogo} alt="Logo" className="w-full h-full object-contain -rotate-12 group-hover:rotate-0 transition-transform duration-500" />
              ) : (
                <GraduationCap size={48} className="text-white md:size-16 -rotate-12 group-hover:rotate-0 transition-transform duration-500" />
              )}
            </div>
            <div className="absolute -bottom-1 -right-1 md:-bottom-2 md:-right-2 w-10 h-10 md:w-12 md:h-12 bg-emerald-500 rounded-xl md:rounded-2xl flex items-center justify-center shadow-lg text-white">
              <ClipboardCheck size={20} className="md:size-6" />
            </div>
          </div>

          <h1 className="text-4xl md:text-5xl font-black text-slate-900 mb-3 md:mb-4 tracking-tight">
            MTs Al-Khairaat <span className="text-indigo-600">Bunyu</span>
          </h1>
          <div className="mb-6 flex justify-center">
            {appLogo ? (
              <img src={appLogo} alt="Logo" className="w-24 h-24 object-contain" />
            ) : (
              <div className="w-24 h-24 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-100">
                <GraduationCap size={48} className="text-white" />
              </div>
            )}
          </div>
          <p className="text-slate-500 text-base md:text-lg mb-8 md:mb-10 font-medium leading-relaxed">
            Sistem Manajemen Madrasah Modern.<br className="hidden md:block" />
            Kelola data siswa, absensi, dan nilai dengan mudah.
          </p>

          <button 
            onClick={() => setIsDashboard(false)}
            className="group relative w-full py-4 md:py-5 bg-indigo-600 text-white rounded-[1.5rem] md:rounded-[2rem] font-bold text-lg md:text-xl shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-[0.98] overflow-hidden"
          >
            <span className="relative z-10 flex items-center justify-center gap-3">
              Masuk Aplikasi
              <ChevronRight size={24} className="group-hover:translate-x-1 transition-transform" />
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
          </button>

          <button 
            onClick={() => window.location.reload()}
            className="mt-4 w-full py-3 text-slate-400 font-bold text-sm hover:text-red-500 transition-all flex items-center justify-center gap-2"
          >
            <XCircle size={18} />
            Tutup Aplikasi
          </button>

          <div className="mt-12 pt-8 border-t border-slate-50 flex items-center justify-center gap-8 grayscale opacity-50">
             <div className="flex items-center gap-2">
               <div className="w-8 h-8 bg-slate-200 rounded-lg" />
               <span className="text-xs font-bold text-slate-400">MADRASAH DIGITAL</span>
             </div>
          </div>
        </motion.div>

        <p className="mt-8 text-slate-400 text-sm font-medium">
          © 2026 MTs Al-Khairaat Bunyu. All rights reserved.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex overflow-x-hidden">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-md"
            style={{ 
              backgroundColor: toast.type === 'success' ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)',
              color: 'white'
            }}
          >
            {toast.type === 'success' ? <ClipboardCheck size={20} /> : <AlertCircle size={20} />}
            <span className="font-bold text-sm">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import Preview Modal */}
      <AnimatePresence>
        {showPreview && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 md:p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPreview(false)}
              className="absolute inset-0 bg-slate-900/70 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-[2rem] md:rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 md:p-8 border-b border-slate-100 bg-indigo-600 text-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl md:text-2xl font-black uppercase tracking-tight">Konfirmasi Impor</h3>
                  <div className="bg-white/20 px-3 py-1 rounded-full text-[10px] md:text-xs font-bold">
                    {pendingStudents.length} Siswa
                  </div>
                </div>
                <p className="text-indigo-100 text-xs md:text-sm font-medium">Periksa kembali data sebelum disimpan.</p>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-2 bg-slate-50">
                {pendingStudents.map((s, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold text-xs">
                        {i + 1}
                      </div>
                      <span className="font-bold text-slate-800">{s.name}</span>
                    </div>
                    <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase">
                      Kelas {s.class}
                    </span>
                  </div>
                ))}
              </div>

              <div className="p-8 bg-white border-t border-slate-100 flex gap-4">
                <button 
                  onClick={() => setShowPreview(false)}
                  className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black uppercase text-xs hover:bg-slate-200 transition-all"
                >
                  Batal
                </button>
                <button 
                  onClick={confirmImport}
                  disabled={importLoading}
                  className="flex-[2] px-6 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 flex items-center justify-center gap-2"
                >
                  {importLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <ClipboardCheck size={18} />
                      Simpan Data
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Student Modal */}
      <AnimatePresence>
        {isEditModalOpen && editingStudent && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100">
                <h3 className="text-xl font-bold text-slate-900">Edit Data Siswa</h3>
                <p className="text-sm text-slate-500">Perbarui informasi siswa</p>
              </div>
              
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Nama Lengkap</label>
                  <input 
                    type="text"
                    value={editingStudent.name}
                    onChange={(e) => setEditingStudent({ ...editingStudent, name: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Kelas</label>
                  <select 
                    value={editingStudent.class}
                    onChange={(e) => setEditingStudent({ ...editingStudent, class: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  >
                    <option value="7">Kelas 7</option>
                    <option value="8">Kelas 8</option>
                    <option value="9">Kelas 9</option>
                  </select>
                </div>
              </div>
              <div className="p-6 bg-slate-50 flex gap-3">
                <button 
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-100 transition-all"
                >
                  Batal
                </button>
                <button 
                  onClick={handleUpdateStudent}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                >
                  Simpan Perubahan
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteModalOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDeleteModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Hapus Siswa?</h3>
                <p className="text-sm text-slate-500">Tindakan ini tidak dapat dibatalkan. Semua data nilai dan absensi terkait akan ikut terhapus.</p>
              </div>
              <div className="p-6 bg-slate-50 flex gap-3">
                <button 
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-100 transition-all"
                >
                  Batal
                </button>
                <button 
                  onClick={handleDeleteStudent}
                  disabled={importLoading}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-100 flex items-center justify-center gap-2"
                >
                  {importLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Ya, Hapus"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && window.innerWidth <= 768 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside 
        className={cn(
          "bg-white border-r border-slate-200 flex flex-col fixed inset-y-0 left-0 z-50 transition-all duration-300 ease-in-out",
          isSidebarOpen ? "w-64 translate-x-0" : "w-20 -translate-x-full md:translate-x-0"
        )}
      >
        <div className={cn("p-6 flex items-center gap-3 mb-4 overflow-hidden whitespace-nowrap", !isSidebarOpen && "justify-center px-0")}>
          <div className="min-w-[40px] w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-100 overflow-hidden">
            {appLogo ? (
              <img src={appLogo} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <GraduationCap size={24} className="text-white" />
            )}
          </div>
          {isSidebarOpen && <span className="text-xl font-bold text-slate-900">MTs Al-Khairaat</span>}
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-hidden">
          <SidebarItem 
            icon={BarChart3} 
            label={isSidebarOpen ? "Dashboard" : ""} 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <SidebarItem 
            icon={Users} 
            label={isSidebarOpen ? "Data Siswa" : ""} 
            active={activeTab === 'students'} 
            onClick={() => setActiveTab('students')} 
          />
          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mata Pelajaran</p>
          </div>
          <SidebarItem 
            icon={appLogo ? () => <img src={appLogo} className="w-5 h-5 object-contain" /> : GraduationCap} 
            label={isSidebarOpen ? "Kelas 7" : "7"} 
            active={activeTab === 'class-7'} 
            onClick={() => {
              setActiveTab('class-7');
              setSelectedGradeLevel('7');
            }} 
          />
          <SidebarItem 
            icon={appLogo ? () => <img src={appLogo} className="w-5 h-5 object-contain" /> : GraduationCap} 
            label={isSidebarOpen ? "Kelas 8" : "8"} 
            active={activeTab === 'class-8'} 
            onClick={() => {
              setActiveTab('class-8');
              setSelectedGradeLevel('8');
            }} 
          />
          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Wali Kelas</p>
          </div>
          <SidebarItem 
            icon={ClipboardCheck} 
            label={isSidebarOpen ? "Kelas 9" : "9"} 
            active={activeTab === 'class-9'} 
            onClick={() => {
              setActiveTab('class-9');
              setSelectedGradeLevel('9');
            }} 
          />
          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pengaturan</p>
          </div>
          <SidebarItem 
            icon={Settings} 
            label={isSidebarOpen ? "Pengaturan Logo" : ""} 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
          />
        </nav>

        <div className="p-4 border-t border-slate-100">
          {isSidebarOpen && (
            <div className="flex items-center gap-3 p-3 mb-4 bg-slate-50 rounded-xl overflow-hidden">
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold">
                W
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">Wali Kelas</p>
                <p className="text-xs text-slate-500 truncate">Mode Pribadi</p>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main 
        className={cn(
          "flex-1 p-4 md:p-8 transition-all duration-300 ease-in-out min-h-screen w-full",
          isSidebarOpen ? "md:ml-64" : "md:ml-20"
        )}
      >
        <div className="max-w-[1600px] mx-auto">
          {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 md:mb-8">
          <div className="flex items-center justify-between md:justify-start gap-4">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-2 bg-white border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 transition-all shadow-sm"
              >
                <ChevronRight className={cn("transition-transform duration-300", isSidebarOpen && "rotate-180")} size={20} />
              </button>
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900 capitalize">{activeTab.replace('-', ' ')}</h2>
                <p className="text-xs md:text-sm text-slate-500">Selamat datang di MTs Al-Khairaat Bunyu!</p>
              </div>
            </div>
            
            {/* Mobile Exit Button */}
            <button 
              onClick={() => setIsDashboard(true)}
              className="md:hidden p-2 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-all border border-red-100"
              title="Keluar"
            >
              <RotateCcw size={18} />
            </button>
          </div>

          <div className="flex items-center gap-3 md:gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Cari data..." 
                className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all w-full md:w-64 text-sm"
              />
            </div>
            
            {/* Desktop Exit Button */}
            <button 
              onClick={() => setIsDashboard(true)}
              className="hidden md:flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-all border border-red-100"
            >
              <RotateCcw size={18} />
              <span>Keluar</span>
            </button>
            
            <button className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all">
              <Bell size={20} />
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600">
            <AlertCircle size={20} />
            <p className="font-medium">{error}</p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[60vh] space-y-12"
            >
              {/* Large Logo Section */}
              <div className="flex flex-col items-center gap-6">
                <div className="w-32 h-32 md:w-48 md:h-48 bg-indigo-600 rounded-[2.5rem] md:rounded-[3.5rem] flex items-center justify-center shadow-2xl shadow-indigo-200 rotate-6 hover:rotate-0 transition-transform duration-500 overflow-hidden">
                  {appLogo ? (
                    <img src={appLogo} alt="Logo" className="w-full h-full object-contain -rotate-6 group-hover:rotate-0 transition-transform duration-500" />
                  ) : (
                    <GraduationCap size={64} className="text-white md:size-32 -rotate-6 group-hover:rotate-0 transition-transform duration-500" />
                  )}
                </div>
                <div className="text-center">
                  <h2 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight">
                    MTs Al-Khairaat <span className="text-indigo-600">Bunyu</span>
                  </h2>
                  <p className="text-slate-500 font-medium mt-2">Sistem Manajemen Madrasah Modern</p>
                </div>
              </div>

              {/* Single Stats Card */}
              <div className="w-full max-w-sm">
                <Card className="p-8 bg-white border-l-4 border-l-indigo-600 shadow-xl shadow-indigo-50 hover:scale-105 transition-transform">
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                      <Users size={32} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">Total Siswa Terdaftar</p>
                      <h4 className="text-4xl font-black text-slate-900">{students.length}</h4>
                    </div>
                  </div>
                </Card>
              </div>
            </motion.div>
          )}

          {activeTab === 'students' && (
            <motion.div
              key="students"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <h3 className="text-xl font-bold text-slate-900">Daftar Siswa</h3>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                  <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-xl flex-1 sm:flex-none">
                    <Filter size={16} className="text-slate-400" />
                    <select 
                      value={selectedClass} 
                      onChange={(e) => setSelectedClass(e.target.value)}
                      className="bg-transparent text-sm font-medium focus:outline-none w-full"
                    >
                      <option value="All">Pilih Kelas</option>
                      <option value="7">Kelas 7</option>
                      <option value="8">Kelas 8</option>
                      <option value="9">Kelas 9</option>
                    </select>
                  </div>
                  <button 
                    onClick={() => {
                      setNewStudent({ ...newStudent, class: selectedClass === 'All' ? '9' : selectedClass });
                      setIsAddModalOpen(true);
                    }}
                    className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                  >
                    <Plus size={18} />
                    <span>Tambah Siswa</span>
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {isAddModalOpen && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 md:p-4">
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsAddModalOpen(false)}
                      className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 20 }}
                      className="relative bg-white rounded-[2rem] md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[95vh] flex flex-col"
                    >
                      <div className="p-5 md:p-6 border-b border-slate-100">
                        <h3 className="text-lg md:text-xl font-bold text-slate-900">Tambah Siswa Baru</h3>
                        <p className="text-xs md:text-sm text-slate-500">Masukkan data manual atau impor file</p>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto">
                        <div className="p-5 md:p-6 bg-indigo-50/50 border-b border-slate-100">
                          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-3">Impor Data Cepat</p>
                          <div className="grid grid-cols-2 gap-3">
                            <label className="flex flex-col items-center justify-center gap-2 p-4 bg-white border-2 border-dashed border-indigo-200 rounded-2xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all group">
                              <FileSpreadsheet className="text-indigo-400 group-hover:text-indigo-600" size={24} />
                              <span className="text-[10px] font-bold text-slate-600 uppercase">Excel (.xlsx)</span>
                              <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleImportExcel} disabled={importLoading} />
                            </label>
                            <label className="flex flex-col items-center justify-center gap-2 p-4 bg-white border-2 border-dashed border-blue-200 rounded-2xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all group">
                              <FileText className="text-blue-400 group-hover:text-blue-600" size={24} />
                              <span className="text-[10px] font-bold text-slate-600 uppercase">Word (.docx)</span>
                              <input type="file" accept=".docx" className="hidden" onChange={handleImportWord} disabled={importLoading} />
                            </label>
                          </div>
                          <p className="text-[9px] text-slate-400 mt-3 text-center italic">Format kolom: Nomor, Kelas</p>
                        </div>
                        
                        <div className="p-5 md:p-6 space-y-4">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Input Manual</p>
                          <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Nama Lengkap</label>
                            <input 
                              type="text"
                              value={newStudent.name}
                              onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                              placeholder="Contoh: Ahmad Fauzi"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Kelas</label>
                            <select 
                              value={newStudent.class}
                              onChange={(e) => setNewStudent({ ...newStudent, class: e.target.value })}
                              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                            >
                              <option value="7">Kelas 7</option>
                              <option value="8">Kelas 8</option>
                              <option value="9">Kelas 9</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="p-5 md:p-6 bg-slate-50 flex gap-3">
                        <button 
                          onClick={() => setIsAddModalOpen(false)}
                          className="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-100 transition-all"
                        >
                          Batal
                        </button>
                        <button 
                          onClick={async () => {
                            if (newStudent.name && newStudent.class) {
                              await addDoc(collection(db, 'students'), {
                                name: newStudent.name,
                                class: normalizeClass(newStudent.class),
                                nis: '-',
                                status: 'active',
                                createdAt: serverTimestamp()
                              });
                              setToast({ message: "Siswa berhasil ditambahkan!", type: 'success' });
                              setIsAddModalOpen(false);
                              setNewStudent({ name: '', class: '9' });
                            } else {
                              setToast({ message: "Mohon lengkapi nama siswa!", type: 'error' });
                            }
                          }}
                          className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                        >
                          Simpan
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}

                {isEditModalOpen && editingStudent && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 md:p-4">
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsEditModalOpen(false)}
                      className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 20 }}
                      className="relative bg-white rounded-[2rem] md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[95vh] flex flex-col"
                    >
                      <div className="p-5 md:p-6 border-b border-slate-100">
                        <h3 className="text-lg md:text-xl font-bold text-slate-900">Edit Data Siswa</h3>
                        <p className="text-xs md:text-sm text-slate-500">Perbarui informasi siswa</p>
                      </div>
                      
                      <div className="p-5 md:p-6 space-y-4 flex-1 overflow-y-auto">
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Nama Lengkap</label>
                          <input 
                            type="text"
                            value={editingStudent.name}
                            onChange={(e) => setEditingStudent({ ...editingStudent, name: e.target.value })}
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Kelas</label>
                          <select 
                            value={editingStudent.class}
                            onChange={(e) => setEditingStudent({ ...editingStudent, class: e.target.value })}
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                          >
                            <option value="7">Kelas 7</option>
                            <option value="8">Kelas 8</option>
                            <option value="9">Kelas 9</option>
                          </select>
                        </div>
                      </div>
                      <div className="p-5 md:p-6 bg-slate-50 flex gap-3">
                        <button 
                          onClick={() => setIsEditModalOpen(false)}
                          className="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-100 transition-all"
                        >
                          Batal
                        </button>
                        <button 
                          onClick={handleUpdateStudent}
                          className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                        >
                          Simpan
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
              
              <Card>
                <div className="overflow-x-auto pb-4">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-16 text-center sticky left-0 bg-slate-50 z-20">No</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider sticky left-16 bg-slate-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Nama Siswa</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {students
                        .filter(s => selectedClass === 'All' || s.class === selectedClass)
                        .map((student, index) => (
                        <tr key={student.id} className="hover:bg-slate-50 transition-colors group">
                          <td className="px-6 py-4 text-slate-500 text-sm text-center sticky left-0 bg-white group-hover:bg-slate-50 z-10 transition-colors">{index + 1}</td>
                          <td className="px-6 py-4 sticky left-16 bg-white group-hover:bg-slate-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold text-xs">
                                {student.name.charAt(0)}
                              </div>
                              <span className="font-semibold text-slate-900">{student.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2 md:opacity-0 group-hover:opacity-100 transition-all">
                              <button 
                                onClick={() => {
                                  setEditingStudent(student);
                                  setIsEditModalOpen(true);
                                }}
                                className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                title="Edit Siswa"
                              >
                                <Edit size={16} />
                              </button>
                              <button 
                                onClick={() => {
                                  setDeletingStudentId(student.id);
                                  setIsDeleteModalOpen(true);
                                }}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                title="Hapus Siswa"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {students.filter(s => selectedClass === 'All' || s.class === selectedClass).length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-6 py-12 text-center text-slate-500">
                            Belum ada data siswa untuk filter ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <Card className="p-8 max-w-2xl mx-auto mt-8">
                <div className="flex items-center gap-4 mb-8">
                  <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                    <Settings size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Pengaturan Logo Madrasah</h3>
                    <p className="text-sm text-slate-500">Ubah logo yang tampil di sidebar dan halaman utama</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex justify-center flex-col items-center gap-4">
                    <div className="relative group">
                      <div className="w-32 h-32 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden">
                        {appLogo ? (
                          <img src={appLogo} alt="Preview Logo" className="w-full h-full object-contain" />
                        ) : (
                          <GraduationCap size={48} className="text-slate-300" />
                        )}
                      </div>
                      <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-2xl">
                        <FileUp className="text-white" size={24} />
                        <input 
                          type="file" 
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (file.size > 1024 * 1024) { // Limiting to 1MB for Firestore string storage
                                setToast({ message: "Ukuran gambar terlalu besar (maks 1MB)", type: 'error' });
                                return;
                              }
                              const reader = new FileReader();
                              reader.onloadend = () => {
                                setAppLogo(reader.result as string);
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                    </div>
                    <p className="text-xs text-slate-400">Klik gambar untuk upload (Format: PNG, JPG, maks 1MB)</p>
                  </div>

                  <div className="pt-4 flex flex-col items-center gap-4">
                    <button 
                      onClick={async () => {
                        setIsSaving(true);
                        try {
                          if (settingsId) {
                            await updateDoc(doc(db, 'appSettings', settingsId), {
                              logoUrl: appLogo,
                              updatedAt: serverTimestamp()
                            });
                          } else {
                            await addDoc(collection(db, 'appSettings'), {
                              logoUrl: appLogo,
                              updatedAt: serverTimestamp()
                            });
                          }
                          setToast({ message: "Logo berhasil disimpan!", type: 'success' });
                        } catch (err) {
                          console.error("Save settings error:", err);
                          setToast({ message: "Gagal menyimpan logo ke database.", type: 'error' });
                        } finally {
                          setIsSaving(false);
                        }
                      }}
                      disabled={isSaving || !appLogo}
                      className="w-full bg-indigo-600 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                    >
                      {isSaving ? <RotateCcw className="animate-spin" size={18} /> : <Save size={18} />}
                      Terapkan Perubahan Logo
                    </button>
                  </div>

                  <div className="pt-6 border-t border-slate-100">
                    <button 
                      onClick={async () => {
                        if (settingsId) {
                          setIsSaving(true);
                          try {
                            await updateDoc(doc(db, 'appSettings', settingsId), {
                              logoUrl: null,
                              updatedAt: serverTimestamp()
                            });
                            setAppLogo(null);
                            setToast({ message: "Logo dikembalikan ke standar.", type: 'success' });
                          } catch (err) {
                            setToast({ message: "Gagal menghapus logo.", type: 'error' });
                          } finally {
                            setIsSaving(false);
                          }
                        }
                      }}
                      className="text-slate-400 hover:text-red-500 text-xs font-bold transition-all flex items-center gap-2"
                    >
                      <Trash2 size={14} />
                      Kembalikan ke Logo Standar
                    </button>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {(activeTab === 'class-7' || activeTab === 'class-8' || (activeTab === 'class-9' && subTab === 'grades')) && (
            <motion.div
              key="grades"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              {activeTab === 'class-9' && (
                <div className="flex flex-wrap gap-2 md:gap-4 mb-6 bg-white p-1 rounded-2xl border border-slate-200 w-fit">
                  <button 
                    onClick={() => setSubTab('attendance')}
                    className={cn("px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all", subTab === 'attendance' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-500 hover:bg-slate-50")}
                  >
                    Absensi
                  </button>
                  <button 
                    onClick={() => setSubTab('attendance-rekap-bulanan')}
                    className={cn("px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all", subTab === 'attendance-rekap-bulanan' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-500 hover:bg-slate-50")}
                  >
                    Rekap Bulanan
                  </button>
                  <button 
                    onClick={() => setSubTab('attendance-rekap-semester')}
                    className={cn("px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all", subTab === 'attendance-rekap-semester' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-500 hover:bg-slate-50")}
                  >
                    Rekap Semester
                  </button>
                  <button 
                    onClick={() => setSubTab('grades')}
                    className={cn("px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all", subTab === 'grades' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-500 hover:bg-slate-50")}
                  >
                    Rekap Nilai
                  </button>
                </div>
              )}

              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Rekap Nilai Harian & Ulangan</h3>
                  <p className="text-sm text-slate-500">Mata Pelajaran: {selectedSubject} | Kelas {selectedGradeLevel}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <select 
                    value={selectedSubject} 
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    className="bg-white border border-slate-200 px-3 py-2 rounded-xl text-sm font-medium focus:outline-none"
                  >
                    {SUBJECTS.map(s => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleSaveGrades}
                    disabled={isSaving || Object.keys(pendingGrades).length === 0}
                    className={cn(
                      "flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all shadow-lg",
                      Object.keys(pendingGrades).length > 0 
                        ? "bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700" 
                        : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                    )}
                  >
                    <Save size={18} />
                    {isSaving ? "Menyimpan..." : "Simpan Nilai"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleExportExcel('grades')} className="p-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100" title="Export Excel">
                      <Download size={18} />
                    </button>
                    <button onClick={() => handleExportWord('grades')} className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100" title="Export Word">
                      <Download size={18} />
                    </button>
                    <button onClick={() => handleReset('grades')} className="p-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-100" title="Reset Data">
                      <RotateCcw size={18} />
                    </button>
                  </div>
                </div>
              </div>

              <Card className="mb-8">
                <div className="overflow-x-auto pb-4">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th rowSpan={2} className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-12 border-r border-slate-100 sticky left-0 bg-slate-50 z-30">No</th>
                        <th rowSpan={2} className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider min-w-[150px] border-r border-slate-100 sticky left-12 bg-slate-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Nama Siswa</th>
                        <th rowSpan={2} className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-20 border-r border-slate-100 sticky left-[202px] bg-slate-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Aksi</th>
                        <th colSpan={10} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-center border-b border-r border-slate-100 bg-indigo-50/50">Nilai Harian (1-10)</th>
                        <th colSpan={10} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-center border-b border-r border-slate-100 bg-emerald-50/50">Ulangan Harian (1-10)</th>
                        <th colSpan={5} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-center border-b border-r border-slate-100 bg-amber-50/50">Praktek (1-5)</th>
                        <th rowSpan={2} className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center bg-slate-100/50">Rata-rata</th>
                      </tr>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        {[...Array(10)].map((_, i) => <th key={`h-${i}`} className="px-2 py-2 text-[10px] font-bold text-slate-400 text-center border-r border-slate-100">{i + 1}</th>)}
                        {[...Array(10)].map((_, i) => <th key={`u-${i}`} className="px-2 py-2 text-[10px] font-bold text-slate-400 text-center border-r border-slate-100">{i + 1}</th>)}
                        {[...Array(5)].map((_, i) => <th key={`p-${i}`} className="px-2 py-2 text-[10px] font-bold text-slate-400 text-center border-r border-slate-100">{i + 1}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {students.filter(s => s.class === selectedGradeLevel).length > 0 ? (
                        students
                          .filter(s => s.class === selectedGradeLevel)
                          .map((student, index) => {
                            const grade = grades.find(g => g.studentId === student.id && g.subject === selectedSubject && g.gradeLevel === selectedGradeLevel);
                            const studentPending = pendingGrades[student.id];
                            
                            const displayGrades = {
                              dailyGrades: studentPending?.dailyGrades || grade?.dailyGrades || new Array(10).fill(0),
                              testGrades: studentPending?.testGrades || grade?.testGrades || new Array(10).fill(0),
                              practicalGrades: studentPending?.practicalGrades || grade?.practicalGrades || new Array(5).fill(0),
                            };

                            const allGrades = [...displayGrades.dailyGrades, ...displayGrades.testGrades, ...displayGrades.practicalGrades];
                            const gradedValues = allGrades.filter(v => v > 0);
                            const average = gradedValues.length > 0 
                              ? (gradedValues.reduce((a, b) => a + b, 0) / gradedValues.length).toFixed(1) 
                              : '-';

                            const updateGrade = (type: 'daily' | 'test' | 'practical', idx: number, val: string) => {
                              const numVal = parseInt(val) || 0;
                              const newGrades = { ...displayGrades };
                              
                              if (type === 'daily') newGrades.dailyGrades = [...newGrades.dailyGrades];
                              if (type === 'test') newGrades.testGrades = [...newGrades.testGrades];
                              if (type === 'practical') newGrades.practicalGrades = [...newGrades.practicalGrades];

                              if (type === 'daily') newGrades.dailyGrades[idx] = numVal;
                              if (type === 'test') newGrades.testGrades[idx] = numVal;
                              if (type === 'practical') newGrades.practicalGrades[idx] = numVal;

                              setPendingGrades(prev => ({
                                ...prev,
                                [student.id]: newGrades
                              }));
                            };

                            return (
                              <tr key={student.id} className="hover:bg-slate-50 transition-colors h-12 group">
                                <td className="px-4 py-3 text-slate-600 font-medium border-r border-slate-100 sticky left-0 bg-white group-hover:bg-slate-50 z-20 transition-colors">
                                  {index + 1}
                                </td>
                                <td className="px-4 py-3 border-r border-slate-100 sticky left-12 bg-white group-hover:bg-slate-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] transition-colors">
                                  <span className="font-semibold text-slate-900 text-sm">{student.name}</span>
                                </td>
                                <td className="px-2 py-3 border-r border-slate-100 sticky left-[202px] bg-white group-hover:bg-slate-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] transition-colors">
                                  <div className="flex items-center justify-center gap-1">
                                    <button 
                                      onClick={() => {
                                        setEditingStudent(student);
                                        setIsEditModalOpen(true);
                                      }}
                                      className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                      title="Edit Siswa"
                                    >
                                      <Edit size={14} />
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setDeletingStudentId(student.id);
                                        setIsDeleteModalOpen(true);
                                      }}
                                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                      title="Hapus Siswa"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                                {[...Array(10)].map((_, i) => (
                                  <td key={`h-${student.id}-${i}`} className="p-0 border-r border-slate-100">
                                    <input 
                                      type="number" 
                                      className={cn(
                                        "w-full h-full p-2 text-center text-xs focus:outline-none cursor-pointer hover:bg-slate-50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                        studentPending?.dailyGrades ? "bg-indigo-50/50 focus:bg-indigo-100" : "focus:bg-indigo-50"
                                      )}
                                      value={displayGrades.dailyGrades[i] || ''}
                                      onChange={(e) => updateGrade('daily', i, e.target.value)}
                                    />
                                  </td>
                                ))}
                                {[...Array(10)].map((_, i) => (
                                  <td key={`u-${student.id}-${i}`} className="p-0 border-r border-slate-100">
                                    <input 
                                      type="number" 
                                      className={cn(
                                        "w-full h-full p-2 text-center text-xs focus:outline-none cursor-pointer hover:bg-slate-50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                        studentPending?.testGrades ? "bg-emerald-50/50 focus:bg-emerald-100" : "focus:bg-emerald-50"
                                      )}
                                      value={displayGrades.testGrades[i] || ''}
                                      onChange={(e) => updateGrade('test', i, e.target.value)}
                                    />
                                  </td>
                                ))}
                                {[...Array(5)].map((_, i) => (
                                  <td key={`p-${student.id}-${i}`} className="p-0 border-r border-slate-100">
                                    <input 
                                      type="number" 
                                      className={cn(
                                        "w-full h-full p-2 text-center text-xs focus:outline-none cursor-pointer hover:bg-slate-50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                        studentPending?.practicalGrades ? "bg-amber-50/50 focus:bg-amber-100" : "focus:bg-amber-50"
                                      )}
                                      value={displayGrades.practicalGrades[i] || ''}
                                      onChange={(e) => updateGrade('practical', i, e.target.value)}
                                    />
                                  </td>
                                ))}
                                <td className="px-4 py-3 text-center font-bold text-slate-900 bg-slate-50/30 border-l border-slate-100">
                                  {average}
                                </td>
                              </tr>
                            );
                          })
                      ) : (
                        <tr>
                          <td colSpan={27} className="px-6 py-20 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-300">
                                <Users size={32} />
                              </div>
                              <p className="text-slate-500 font-medium">Belum ada data siswa di Kelas {selectedGradeLevel}</p>
                              <button 
                                onClick={() => setActiveTab('students')}
                                className="text-indigo-600 text-sm font-bold hover:underline"
                              >
                                Tambah siswa sekarang →
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === 'class-9' && (subTab === 'attendance' || subTab === 'attendance-rekap-bulanan' || subTab === 'attendance-rekap-semester') && (
            <motion.div
              key={subTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="flex flex-wrap gap-2 md:gap-4 mb-6 bg-white p-1 rounded-2xl border border-slate-200 w-fit">
                <button 
                  onClick={() => setSubTab('attendance')}
                  className={cn("px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all", subTab === 'attendance' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-500 hover:bg-slate-50")}
                >
                  Absensi
                </button>
                <button 
                  onClick={() => setSubTab('attendance-rekap-bulanan')}
                  className={cn("px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all", subTab === 'attendance-rekap-bulanan' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-500 hover:bg-slate-50")}
                >
                  Rekap Bulanan
                </button>
                <button 
                  onClick={() => setSubTab('attendance-rekap-semester')}
                  className={cn("px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all", subTab === 'attendance-rekap-semester' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-500 hover:bg-slate-50")}
                >
                  Rekap Semester
                </button>
                <button 
                  onClick={() => setSubTab('grades')}
                  className={cn("px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all", subTab === 'grades' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-500 hover:bg-slate-50")}
                >
                  Rekap Nilai
                </button>
              </div>

              {subTab === 'attendance' ? (
                <>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Absensi Siswa Kelas 9</h3>
                      <p className="text-sm text-slate-500">Mode Wali Kelas Pribadi</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                      <input 
                        type="date" 
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="bg-white border border-slate-200 px-3 py-2 rounded-xl text-sm font-medium focus:outline-none flex-1 sm:flex-none"
                      />
                      <button
                        onClick={handleSaveAttendance}
                        disabled={isSaving || Object.keys(pendingAttendance).length === 0}
                        className={cn(
                          "flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all shadow-lg",
                          Object.keys(pendingAttendance).length > 0 
                            ? "bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700" 
                            : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                        )}
                      >
                        <Save size={18} />
                        {isSaving ? "Menyimpan..." : "Simpan Absen"}
                      </button>
                      <div className="flex items-center justify-center gap-2 bg-white p-1 rounded-xl border border-slate-100 shadow-sm">
                        <button onClick={() => handleExportExcel('attendance')} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all" title="Export Excel">
                          <Download size={18} />
                        </button>
                        <button onClick={() => handleExportWord('attendance')} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Export Word">
                          <Download size={18} />
                        </button>
                        <div className="w-px h-4 bg-slate-200 mx-1" />
                        <button onClick={() => handleReset('attendance')} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all" title="Reset Data">
                          <RotateCcw size={18} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <Card>
                    <div className="overflow-x-auto pb-4">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th rowSpan={2} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-16 sticky left-0 bg-slate-50 z-30 border-r border-slate-100">No</th>
                            <th rowSpan={2} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider sticky left-16 bg-slate-50 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] border-r border-slate-100">Nama Siswa</th>
                            <th rowSpan={2} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center border-r border-slate-100">Aksi</th>
                            <th rowSpan={2} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-r border-slate-100">Keterangan (H, A, I, S)</th>
                            <th colSpan={4} className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center bg-slate-100/50 border-b border-slate-100">Jumlah Kehadiran (Total)</th>
                          </tr>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-4 py-2 text-[10px] font-bold text-emerald-600 text-center bg-emerald-50/30 border-r border-slate-100">Hadir (H)</th>
                            <th className="px-4 py-2 text-[10px] font-bold text-red-600 text-center bg-red-50/30 border-r border-slate-100">Alpa (A)</th>
                            <th className="px-4 py-2 text-[10px] font-bold text-blue-600 text-center bg-blue-50/30 border-r border-slate-100">Izin (I)</th>
                            <th className="px-4 py-2 text-[10px] font-bold text-amber-600 text-center bg-amber-50/30">Sakit (S)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {students
                            .filter(s => s.class === '9')
                            .map((student, index) => {
                              const record = attendance.find(a => a.studentId === student.id && a.date === selectedDate);
                              const currentStatus = pendingAttendance[student.id] || record?.status;
                              
                              // Calculate total H, A, I, S for this student across all dates, including pending
                              const otherRecords = attendance.filter(a => a.studentId === student.id && a.date !== selectedDate);
                              const counts = {
                                H: otherRecords.filter(r => r.status === 'H').length + (currentStatus === 'H' ? 1 : 0),
                                A: otherRecords.filter(r => r.status === 'A').length + (currentStatus === 'A' ? 1 : 0),
                                I: otherRecords.filter(r => r.status === 'I').length + (currentStatus === 'I' ? 1 : 0),
                                S: otherRecords.filter(r => r.status === 'S').length + (currentStatus === 'S' ? 1 : 0),
                              };

                              return (
                                <tr key={student.id} className="hover:bg-slate-50 transition-colors group">
                                  <td className="px-6 py-4 text-slate-600 font-medium sticky left-0 bg-white group-hover:bg-slate-50 z-10 transition-colors">{index + 1}</td>
                                  <td className="px-6 py-4 sticky left-16 bg-white group-hover:bg-slate-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] transition-colors">
                                    <span className="font-semibold text-slate-900">{student.name}</span>
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <button 
                                        onClick={() => {
                                          setEditingStudent(student);
                                          setIsEditModalOpen(true);
                                        }}
                                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                        title="Edit Siswa"
                                      >
                                        <Edit size={14} />
                                      </button>
                                      <button 
                                        onClick={() => {
                                          setDeletingStudentId(student.id);
                                          setIsDeleteModalOpen(true);
                                        }}
                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                        title="Hapus Siswa"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-4 md:px-6 py-4">
                                    <div className="flex items-center gap-1.5 md:gap-2">
                                      {['H', 'A', 'I', 'S'].map((status) => (
                                        <button
                                          key={status}
                                          onClick={() => {
                                            setPendingAttendance(prev => {
                                              const current = prev[student.id] || record?.status;
                                              if (current === status) {
                                                return { ...prev, [student.id]: 'NONE' };
                                              }
                                              return { ...prev, [student.id]: status };
                                            });
                                          }}
                                          className={cn(
                                            "w-9 h-9 md:w-11 md:h-11 rounded-lg md:rounded-xl font-bold transition-all flex items-center justify-center cursor-pointer active:scale-95 text-xs md:text-base",
                                            currentStatus === status 
                                              ? (status === 'H' ? "bg-emerald-500 text-white shadow-lg shadow-emerald-100" : 
                                                 status === 'A' ? "bg-red-500 text-white shadow-lg shadow-red-100" :
                                                 status === 'I' ? "bg-blue-500 text-white shadow-lg shadow-blue-100" : "bg-amber-500 text-white shadow-lg shadow-amber-100")
                                              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                          )}
                                        >
                                          {status}
                                        </button>
                                      ))}
                                      {(pendingAttendance[student.id]) && (
                                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse ml-1" title="Belum disimpan" />
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-4 text-center font-bold text-emerald-600 bg-emerald-50/20">{counts.H}</td>
                                  <td className="px-4 py-4 text-center font-bold text-red-600 bg-red-50/20">{counts.A}</td>
                                  <td className="px-4 py-4 text-center font-bold text-blue-600 bg-blue-50/20">{counts.I}</td>
                                  <td className="px-4 py-4 text-center font-bold text-amber-600 bg-amber-50/20">{counts.S}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              ) : (
                <>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">
                        {subTab === 'attendance-rekap-bulanan' ? "Rekapitulasi Absensi Bulanan (Kelas 9)" : "Rekapitulasi Absensi Per Semester (Kelas 9)"}
                      </h3>
                      <p className="text-sm text-slate-500">
                        {subTab === 'attendance-rekap-bulanan' 
                          ? `Bulan: ${new Date(selectedDate).toLocaleString('id-ID', { month: 'long', year: 'numeric' })}` 
                          : `Semester: ${new Date(selectedDate).getMonth() >= 6 ? '1 (Ganjil)' : '2 (Genap)'} | Tahun: ${new Date(selectedDate).getFullYear()}`
                        }
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {subTab === 'attendance-rekap-bulanan' && (
                        <input 
                          type="month" 
                          value={selectedDate.substring(0, 7)}
                          onChange={(e) => setSelectedDate(`${e.target.value}-01`)}
                          className="bg-white border border-slate-200 px-3 py-2 rounded-xl text-sm font-medium focus:outline-none"
                        />
                      )}
                      <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-100 shadow-sm">
                        <button onClick={() => handleExportExcel('attendance')} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all" title="Export Excel">
                          <Download size={18} />
                        </button>
                        <button onClick={() => handleExportWord('attendance')} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Export Word">
                          <Download size={18} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <Card>
                    <div className="overflow-x-auto pb-4">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-16 sticky left-0 bg-slate-50 z-20">No</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider sticky left-16 bg-slate-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Nama Siswa</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center bg-emerald-50/30">Hadir (H)</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center bg-red-50/30">Alpa (A)</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center bg-blue-50/30">Izin (I)</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center bg-amber-50/30">Sakit (S)</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center bg-indigo-50/30">Total Hari</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {students
                            .filter(s => s.class === '9')
                            .map((student, index) => {
                              const filterAttendance = (a: any) => {
                                const aDate = new Date(a.date);
                                const sDate = new Date(selectedDate);
                                if (subTab === 'attendance-rekap-bulanan') {
                                  return aDate.getMonth() === sDate.getMonth() && aDate.getFullYear() === sDate.getFullYear();
                                } else {
                                  const sMonth = sDate.getMonth();
                                  const aMonth = aDate.getMonth();
                                  const sSemester = sMonth >= 6 ? 1 : 2; // 1: Jul-Dec, 2: Jan-Jun
                                  const aSemester = aMonth >= 6 ? 1 : 2;
                                  return sSemester === aSemester && aDate.getFullYear() === sDate.getFullYear();
                                }
                              };

                              const filteredAttendance = attendance.filter(a => a.studentId === student.id && filterAttendance(a));
                              
                              const counts = {
                                H: filteredAttendance.filter(r => r.status === 'H').length,
                                A: filteredAttendance.filter(r => r.status === 'A').length,
                                I: filteredAttendance.filter(r => r.status === 'I').length,
                                S: filteredAttendance.filter(r => r.status === 'S').length,
                              };
                              const total = counts.H + counts.A + counts.I + counts.S;

                              return (
                                <tr key={student.id} className="hover:bg-slate-50 transition-colors group">
                                  <td className="px-6 py-4 text-slate-600 font-medium sticky left-0 bg-white group-hover:bg-slate-50 z-10 transition-colors">{index + 1}</td>
                                  <td className="px-6 py-4 sticky left-16 bg-white group-hover:bg-slate-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] transition-colors">
                                    <span className="font-semibold text-slate-900">{student.name}</span>
                                  </td>
                                  <td className="px-6 py-4 text-center font-bold text-emerald-600">{counts.H}</td>
                                  <td className="px-6 py-4 text-center font-bold text-red-600">{counts.A}</td>
                                  <td className="px-6 py-4 text-center font-bold text-blue-600">{counts.I}</td>
                                  <td className="px-6 py-4 text-center font-bold text-amber-600">{counts.S}</td>
                                  <td className="px-6 py-4 text-center font-bold text-indigo-600">{total}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
