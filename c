#!/usr/bin/env node
/**
 * Production Configuration Validator
 * 
 * This script validates that all required environment variables are set
 * and that the frontend build will have the correct configuration.
 * 
 * Run: node scripts/validate-production.js
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Required environment variables
const REQUIRED_VARS = {
  // Backend (server-side)
  INSFORGE_URL: 'InsForge API URL (e.g., https://your-app.region.insforge.app)',
  INSFORGE_SERVICE_KEY: 'InsForge Service Role Key for database writes',
  JWT_SECRET: 'JWT signing secret',
  FRONTEND_URL: 'Frontend URL for CORS (e.g., https://your-app.up.railway.app)',
  
  // Frontend (Vite build-time)
  VITE_INSFORGE_BASE_URL: 'InsForge URL for client SDK',
  VITE_INSFORGE_ANON_KEY: 'InsForge Anonymous Key for client SDK',
  VITE_API_URL: 'API URL for client (usually /api)',
};

// Unsafe patterns to check in source code
const UNSAFE_PATTERNS = [
  '755d753k',
  'localhost:5173',
  '127.0.0.1:5173',
  'http://localhost',
  'https://your-app',
  'example.com',
  'example.org',
];

let hasErrors = false;
let hasWarnings = false;

console.log('🔍 DialerJazz Production Configuration Validator\n');
console.log('=' .repeat(50) + '\n');

// 1. Check environment variables
console.log('📋 Environment Variables Check:\n');

for (const [varName, description] of Object.entries(REQUIRED_VARS)) {
  const value = process.env[varName];
  
  if (!value) {
    console.log(`  ❌ ${varName}: NOT SET`);
    console.log(`     Purpose: ${description}`);
    hasErrors = true;
  } else if (value.includes('your-') || value.includes('example') || value.includes('localhost')) {
    console.log(`  ⚠️  ${varName}: Using placeholder value`);
    console.log(`     Purpose: ${description}`);
    hasWarnings = true;
  } else {
    console.log(`  ✅ ${varName}: Set`);
  }
}

console.log('\n' + '='.repeat(50) + '\n');

// 2. Check for unsafe patterns in source code
console.log('🔍 Source Code Safety Check:\n');

function checkFileForUnsafePatterns(filePath, content) {
  const lines = content.split('\n');
  const issues = [];
  
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of UNSAFE_PATTERNS) {
      if (lines[i].includes(pattern)) {
        issues.push({
          file: filePath,
          line: i + 1,
          pattern,
          content: lines[i].trim()
        });
      }
    }
  }
  
  return issues;
}

const filesToCheck = [
  'client/src/lib/insforge.ts',
  'server/src/lib/insforge.ts',
  'client/vite.config.ts',
  'server/src/index.ts',
];

const allIssues = [];

for (const file of filesToCheck) {
  const fullPath = resolve(rootDir, file);
  if (existsSync(fullPath)) {
    const content = readFileSync(fullPath, 'utf-8');
    const issues = checkFileForUnsafePatterns(file, content);
    allIssues.push(...issues);
  }
}

if (allIssues.length > 0) {
  console.log('  ❌ Found unsafe patterns in source code:\n');
  for (const issue of allIssues) {
    console.log(`  File: ${issue.file}:${issue.line}`);
    console.log(`  Pattern: ${issue.pattern}`);
    console.log(`  Content: ${issue.content}\n`);
    hasErrors = true;
  }
} else {
  console.log('  ✅ No unsafe patterns found in source code\n');
}

console.log('='.repeat(50) + '\n');

// 3. Check Dockerfile for VITE_ env handling
console.log('🐳 Dockerfile Check:\n');

const dockerfile = readFileSync(resolve(rootDir, 'Dockerfile'), 'utf-8');

if (dockerfile.includes('ARG VITE_INSFORGE_BASE_URL') && 
    dockerfile.includes('ENV VITE_INSFORGE_BASE_URL=')) {
  console.log('  ✅ Dockerfile: VITE_INSFORGE_BASE_URL properly configured\n');
} else {
  console.log('  ❌ Dockerfile: VITE_INSFORGE_BASE_URL not properly configured\n');
  hasErrors = true;
}

if (dockerfile.includes('ARG VITE_INSFORGE_ANON_KEY') && 
    dockerfile.includes('ENV VITE_INSFORGE_ANON_KEY=')) {
  console.log('  ✅ Dockerfile: VITE_INSFORGE_ANON_KEY properly configured\n');
} else {
  console.log('  ❌ Dockerfile: VITE_INSFORGE_ANON_KEY not properly configured\n');
  hasErrors = true;
}

console.log('='.repeat(50) + '\n');

// 4. Check OAuth configuration
console.log('🔐 OAuth Configuration Check:\n');

const authContext = readFileSync(resolve(rootDir, 'client/src/contexts/AuthContext.tsx'), 'utf-8');

if (authContext.includes("redirectTo: `${window.location.origin}/dashboard`")) {
  console.log('  ✅ OAuth redirect uses dynamic window.location.origin\n');
} else {
  console.log('  ⚠️  OAuth redirect may not be dynamic\n');
  hasWarnings = true;
}

console.log('='.repeat(50) + '\n');

// 5. Check CORS configuration
console.log('🌐 CORS Configuration Check:\n');

const serverIndex = readFileSync(resolve(rootDir, 'server/src/index.ts'), 'utf-8');

if (serverIndex.includes('process.env.FRONTEND_URL')) {
  console.log('  ✅ CORS uses FRONTEND_URL environment variable\n');
} else {
  console.log('  ❌ CORS does not use FRONTEND_URL\n');
  hasErrors = true;
}

console.log('='.repeat(50) + '\n');

// Final result
if (hasErrors) {
  console.log('❌ VALIDATION FAILED - Fix errors before deploying to production\n');
  process.exit(1);
} else if (hasWarnings) {
  console.log('⚠️  VALIDATION PASSED WITH WARNINGS - Review before deploying\n');
  process.exit(0);
} else {
  console.log('✅ VALIDATION PASSED - Ready for production deployment\n');
  process.exit(0);
}