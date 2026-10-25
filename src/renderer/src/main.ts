import './styles/theme.css'
import './styles/base.css'
import './styles/controls.css'
import './styles/motion.css'
import { mount } from 'svelte'
import App from './App.svelte'

mount(App, { target: document.getElementById('root')! })
