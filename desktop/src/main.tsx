import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './sync.css';
import { App } from './App';
import { DriveAllocationManager } from './DriveAllocationManager';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/><DriveAllocationManager/></React.StrictMode>);