import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './index.css';

// Connect to backend Socket.IO server
// Use .env variable (Vite requires it to start with VITE_)
const socket = io(import.meta.env.VITE_BACKEND_URL);

export default function App() {
  const [chats, setChats] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [typingFrom, setTypingFrom] = useState(null);
  const bodyRef = useRef(null);
  const fileInputRef = useRef(null);

  const selectedChat = useMemo(
    () => chats.find(c => c.wa_id === selected) || null,
    [chats, selected]
  );

  async function loadChats() {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/chats`);
    const data = await res.json();
    setChats(data);
    if (data.length && !selected) setSelected(data[0].wa_id);
  }

  async function loadContacts() {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/contacts`);
    const data = await res.json();
    setContacts(data);
  }

  async function loadMessages(wa_id) {
    if (!wa_id) return;
    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/messages/${wa_id}`);
    const data = await res.json();
    setMessages(data);
    setTimeout(() => bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight), 0);
  }

  useEffect(() => { loadChats(); loadContacts(); }, []);
  useEffect(() => {
    if (selected) {
      loadMessages(selected);
      fetch(`${import.meta.env.VITE_BACKEND_URL}/api/chats/${selected}/read`, { method: 'PUT' })
        .then(loadChats);
    }
  }, [selected]);

  useEffect(() => {
    function onNew(msg) {
      if (msg.wa_id === selected) setMessages(prev => [...prev, msg]);
      loadChats();
    }
    function onUpdate(msg) {
      if (msg.wa_id === selected) {
        setMessages(prev => prev.map(m => m._id === msg._id ? msg : m));
      }
      loadChats();
    }
    function onTyping(payload) {
      setTypingFrom(payload?.wa_id || null);
      setTimeout(() => setTypingFrom(null), 1500);
    }

    socket.on('messages:new', onNew);
    socket.on('messages:update', onUpdate);
    socket.on('typing', onTyping);

    return () => {
      socket.off('messages:new', onNew);
      socket.off('messages:update', onUpdate);
      socket.off('typing', onTyping);
    };
  }, [selected]);

  async function sendMessage() {
    const wa_id = selected || prompt('Enter wa_id');
    if (!wa_id || !text.trim()) return;

    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wa_id, text, type: 'text' })
    });
    const msg = await res.json();

    setText('');
    if (msg.wa_id === selected) setMessages(prev => [...prev, msg]);
    loadChats();
    setTimeout(() => bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight), 0);
  }

  async function uploadAndSendImage(file) {
    const fd = new FormData();
    fd.append('file', file);
    const up = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/upload`, { method: 'POST', body: fd });
    const { url, mime } = await up.json();

    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wa_id: selected,
        type: 'image',
        mediaUrl: url,
        mediaMime: mime
      })
    });
    const msg = await res.json();

    if (msg.wa_id === selected) setMessages(prev => [...prev, msg]);
    loadChats();
    setTimeout(() => bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight), 0);
  }

  async function addContact() {
    const wa_id = prompt('Phone (wa_id):');
    if (!wa_id) return;
    const displayName = prompt('Display name:');

    await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wa_id, displayName })
    });

    await loadContacts();
    await loadChats();
  }

  return (
    <div className={`app ${showSidebar ? 'show-sidebar' : ''}`}>
      {/* Sidebar */}
      {/* ... keep your sidebar and chat UI code unchanged ... */}
    </div>
  );
}
