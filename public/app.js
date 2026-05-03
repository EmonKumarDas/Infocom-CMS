const API_URL = '/api';

// --- AUTH CHECK ---
const token = localStorage.getItem('token');
const userRole = localStorage.getItem('role');
const username = localStorage.getItem('username');
const permissionsStr = localStorage.getItem('permissions') || '[]';
let userPermissions = [];
try { userPermissions = JSON.parse(permissionsStr); } catch(e) {}

if (!token) {
    window.location.href = 'login.html';
}

// Add user info to UI
document.addEventListener('DOMContentLoaded', () => {
    const profileImg = document.querySelector('.user-profile img');
    if (profileImg) profileImg.alt = username;
    
    // Hide admin-only sections if user is not admin
    if (userRole !== 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        
        // Hide unpermitted sections
        document.querySelectorAll('.nav-item').forEach(item => {
            const target = item.getAttribute('data-target');
            if (target && !userPermissions.includes(target)) {
                item.style.display = 'none';
            }
        });
        
        // Hide headers to keep the sidebar clean for standard users
        document.querySelectorAll('.nav-menu h3').forEach(h3 => {
            h3.style.display = 'none';
        });

        // Switch to the first available section if the default (dashboard) is hidden
        setTimeout(() => {
            const activeNav = document.querySelector('.nav-item.active');
            if (activeNav && activeNav.style.display === 'none') {
                const visibleNavs = Array.from(document.querySelectorAll('.nav-item')).filter(el => el.style.display !== 'none');
                if(visibleNavs.length > 0) visibleNavs[0].click();
            }
        }, 100);
    }

    // Add logout button
    const header = document.querySelector('header');
    if (header) {
        const logoutBtn = document.createElement('button');
        logoutBtn.textContent = 'Logout';
        logoutBtn.className = 'btn btn-secondary';
        logoutBtn.style.marginLeft = '15px';
        logoutBtn.style.padding = '8px 15px';
        logoutBtn.style.fontSize = '12px';
        logoutBtn.onclick = () => {
            localStorage.clear();
            window.location.href = 'login.html';
        };
        header.querySelector('.user-profile').appendChild(logoutBtn);
    }

    let sseSource = null;
    function initSSE() {
        if (!sseSource && token) {
            sseSource = new EventSource('/api/realtime/dashboard');
            sseSource.onmessage = (e) => {
                if (e.data === 'update') {
                    fetchDashboard();
                    fetchReceives();
                    fetchInvests();
                    fetchCuets();
                }
            };
        }
    }
    initSSE();
});

// --- Tab System Logic ---
window.switchTab = function(showId, hideId, btnElement) {
    document.getElementById(hideId).classList.remove('active');
    document.getElementById(hideId).style.display = 'none';
    
    document.getElementById(showId).style.display = 'block';
    // Small timeout to allow display:block to apply before animating opacity
    setTimeout(() => {
        document.getElementById(showId).classList.add('active');
    }, 10);
    
    // Update active button state
    const container = btnElement.closest('.tabs-container');
    container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
};

// Global fetch interceptor
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (!config) config = {};
    if (!config.headers) config.headers = {};
    
    // Don't override FormData headers (browser sets multipart/form-data boundary automatically)
    if (!(config.body instanceof FormData)) {
        config.headers['Content-Type'] = 'application/json';
    }
    
    if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await originalFetch(resource, config);
    if (response.status === 401 || response.status === 403) {
        localStorage.clear();
        window.location.href = 'login.html';
    }
    return response;
};

// Cache fetched data for easy editing
let employeesData = [];
let locationsData = [];
let tasksData = [];

// --- Navigation Logic ---
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.app-section');
const pageTitle = document.getElementById('page-title');

window.toggleSidebar = function() {
    document.querySelector('.sidebar').classList.toggle('open');
};

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        if(item.id === 'exportBtn') return; // Handled separately
        e.preventDefault();
        
        // Remove active from all
        navItems.forEach(n => n.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));
        
        // Add active to clicked target
        item.classList.add('active');
        const targetId = item.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
        
        // Update Title
        pageTitle.textContent = item.textContent.trim().replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g, '').trim();

        // Close sidebar on mobile
        if(window.innerWidth <= 900) {
            document.querySelector('.sidebar').classList.remove('open');
        }
    });
});

// --- Data Fetching & Rendering ---
async function fetchEmployees() {
    try {
        const res = await fetch(`${API_URL}/employees`);
        if(!res.ok) throw new Error("Server error");
        employeesData = await res.json();
        
        const list = document.getElementById('employeeListDisplay');
        list.innerHTML = '';
        
        const select = document.getElementById('taskEmployees');
        select.innerHTML = '';

        const exportFoodSelect = document.getElementById('exportEmployeeFood');
        if(exportFoodSelect) exportFoodSelect.innerHTML = '';
        
        employeesData.forEach(emp => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${emp.name}</span>
                <div>
                    <button class="btn btn-secondary" onclick="editEmployee(${emp.id})" style="padding: 4px 8px; font-size:12px; margin-right: 5px;">Edit</button>
                    <button class="btn danger-btn" onclick="deleteEmployee(${emp.id})">Delete</button>
                </div>
            `;
            list.appendChild(li);
            
            const opt = document.createElement('option');
            opt.value = emp.id;
            opt.textContent = emp.name;
            select.appendChild(opt);

            const optFood = document.createElement('option');
            optFood.value = emp.id;
            optFood.textContent = emp.name;
            if(exportFoodSelect) exportFoodSelect.appendChild(optFood);
        });
    } catch(e) {
        handleError();
    }
}

async function fetchLocations() {
    try {
        const res = await fetch(`${API_URL}/locations`);
        if(!res.ok) throw new Error("Server error");
        locationsData = await res.json();
        
        const list = document.getElementById('locationListDisplay');
        list.innerHTML = '';
        
        const select = document.getElementById('taskLocation');
        select.innerHTML = '';
        
        locationsData.forEach(loc => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${loc.location_name} (Tk. ${loc.amount})</span>
                <div>
                    <button class="btn btn-secondary" onclick="editLocation(${loc.id})" style="padding: 4px 8px; font-size:12px; margin-right: 5px;">Edit</button>
                    <button class="btn danger-btn" onclick="deleteLocation(${loc.id})">Delete</button>
                </div>
            `;
            list.appendChild(li);
            
            const opt = document.createElement('option');
            opt.value = loc.id;
            opt.textContent = loc.location_name;
            select.appendChild(opt);
        });
    } catch(e) {
        handleError();
    }
}

let currentTaskMonthFilter = '';
let currentTaskYearFilter = '2026';

const filterMonthElement = document.getElementById('filterMonth');
if (filterMonthElement) {
    filterMonthElement.addEventListener('change', (e) => {
        currentTaskMonthFilter = e.target.value;
        renderTasks();
    });
}
const filterYearElement = document.getElementById('filterYear');
if (filterYearElement) {
    filterYearElement.addEventListener('change', (e) => {
        currentTaskYearFilter = e.target.value;
        renderTasks();
    });
}

async function fetchTasks() {
    try {
        const res = await fetch(`${API_URL}/tasks`);
        if(!res.ok) throw new Error("Server error");
        tasksData = await res.json();
        renderTasks();
    } catch(e) {
        handleError();
    }
}

function renderTasks() {
    const tbody = document.querySelector('#tasksTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Filter tasks
    let filteredTasks = tasksData.filter(task => {
        if(!task.date) return false;
        const [year, month, day] = task.date.split('-');
        if(currentTaskYearFilter && year !== currentTaskYearFilter) return false;
        if(currentTaskMonthFilter && month !== currentTaskMonthFilter) return false;
        return true;
    });

    filteredTasks.forEach(task => {
        const tr = document.createElement('tr');
        const statusBadge = task.is_completed ? '<span class="status-badge status-yes">Completed</span>' : '<span class="status-badge status-no">Pending</span>';
        const emps = task.employee_names ? task.employee_names.replace(/,/g, ', ') : 'None';
        
        tr.innerHTML = `
            <td>${task.date}</td>
            <td>${emps}</td>
            <td>${task.task_desc}</td>
            <td>${task.location_name || 'N/A'}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-secondary" onclick="editTask(${task.id})" style="padding: 4px 8px; font-size:12px;">Edit</button>
                <button class="btn danger-btn" onclick="deleteTask(${task.id})" style="padding: 4px 8px; font-size:12px;">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteTask(id) {
    if(!confirm("Are you sure you want to delete this Task?")) return;
    try {
        const res = await fetch(`${API_URL}/tasks/${id}`, { method: 'DELETE' });
        if(res.ok) {
            fetchTasks();
            showToast("Task deleted!");
        } else throw new Error();
    } catch(e) { handleError(); }
}

function handleError() {
    showToast("Error connecting to Backend Server. Please run start.bat!");
}

// --- Form Submissions (Create and Update) ---

document.getElementById('employeeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('employeeId').value;
    const name = document.getElementById('employeeName').value;
    
    try {
        const url = id ? `${API_URL}/employees/${id}` : `${API_URL}/employees`;
        const method = id ? 'PUT' : 'POST';
        
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        if(res.ok) {
            cancelEmployeeEdit();
            showToast(id ? 'Employee Updated Successfully' : 'Employee Added Successfully');
            fetchEmployees();
        }
    } catch(e) { handleError(); }
});

document.getElementById('locationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('locationId').value;
    const location_name = document.getElementById('locationName').value;
    const amount = document.getElementById('locationAmount').value;
    
    try {
        const url = id ? `${API_URL}/locations/${id}` : `${API_URL}/locations`;
        const method = id ? 'PUT' : 'POST';
        
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location_name, amount })
        });
        
        if(res.ok) {
            cancelLocationEdit();
            showToast(id ? 'Location Updated Successfully' : 'Location Added Successfully');
            fetchLocations();
        }
    } catch(e) { handleError(); }
});

document.getElementById('taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('taskId').value;
    
    const employee_ids = Array.from(document.getElementById('taskEmployees').selectedOptions).map(opt => parseInt(opt.value));
    const task_desc = document.getElementById('taskDesc').value;
    const location_id = parseInt(document.getElementById('taskLocation').value);
    const date = document.getElementById('taskDate').value;
    const is_completed = parseInt(document.getElementById('taskCompleted').value);
    const start_time = document.getElementById('taskStartTime').value;
    const end_time = document.getElementById('taskEndTime').value;
    
    try {
        const url = id ? `${API_URL}/tasks/${id}` : `${API_URL}/tasks`;
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task_desc, location_id, date, start_time, end_time, is_completed, employee_ids
            })
        });
        
        if(res.ok) {
            cancelTaskEdit();
            showToast(id ? 'Task Updated Successfully' : 'Task Created Successfully');
            fetchTasks();
        }
    } catch(e) { handleError(); }
});

// --- Edit & Cancel Methods ---

function editEmployee(id) {
    const emp = employeesData.find(e => e.id === id);
    if(!emp) return;
    
    const addEmpNav = document.querySelector('.nav-item[data-target="add-employee-section"]');
    if (addEmpNav) addEmpNav.click();

    document.getElementById('employeeId').value = emp.id;
    document.getElementById('employeeName').value = emp.name;
    document.getElementById('employeeSubmitBtn').textContent = "Update Employee";
    document.getElementById('employeeCancelBtn').style.display = "inline-block";
}
function cancelEmployeeEdit() {
    document.getElementById('employeeForm').reset();
    document.getElementById('employeeId').value = '';
    document.getElementById('employeeSubmitBtn').textContent = "Save Employee";
    document.getElementById('employeeCancelBtn').style.display = "none";
}
document.getElementById('employeeCancelBtn').addEventListener('click', cancelEmployeeEdit);

function editLocation(id) {
    const loc = locationsData.find(l => l.id === id);
    if(!loc) return;
    
    const addLocNav = document.querySelector('.nav-item[data-target="add-location-section"]');
    if (addLocNav) addLocNav.click();
    
    document.getElementById('locationId').value = loc.id;
    document.getElementById('locationName').value = loc.location_name;
    document.getElementById('locationAmount').value = loc.amount;
    document.getElementById('locationSubmitBtn').textContent = "Update Location";
    document.getElementById('locationCancelBtn').style.display = "inline-block";
}
function cancelLocationEdit() {
    document.getElementById('locationForm').reset();
    document.getElementById('locationId').value = '';
    document.getElementById('locationSubmitBtn').textContent = "Save Location";
    document.getElementById('locationCancelBtn').style.display = "none";
}
document.getElementById('locationCancelBtn').addEventListener('click', cancelLocationEdit);


function editTask(id) {
    const task = tasksData.find(t => t.id === id);
    if(!task) return;
    
    // Navigate to team task section
    const teamTaskNav = document.querySelector('.nav-item[data-target="team-task-section"]');
    if (teamTaskNav) teamTaskNav.click();

    // Ensure the Action tab is open
    const actionTabBtn = document.querySelector('#team-task-section .tab-btn[onclick*="task-action"]');
    if (actionTabBtn) switchTab('task-action', 'task-history', actionTabBtn);
    
    document.getElementById('taskId').value = task.id;
    document.getElementById('taskDesc').value = task.task_desc;
    document.getElementById('taskLocation').value = task.location_id;
    document.getElementById('taskDate').value = task.date;
    document.getElementById('taskCompleted').value = task.is_completed;
    document.getElementById('taskStartTime').value = task.start_time;
    document.getElementById('taskEndTime').value = task.end_time;
    
    // Multi select
    const select = document.getElementById('taskEmployees');
    const empNames = task.employee_names ? task.employee_names.split(',') : [];
    // We only have names from the view right now, wait, the DB schema needs empirical employee_ids.
    // Fortunately, we can match by name.
    Array.from(select.options).forEach(opt => {
        opt.selected = empNames.includes(opt.textContent);
    });

    document.getElementById('taskSubmitBtn').textContent = "Update Task";
    document.getElementById('taskCancelBtn').style.display = "inline-block";
}
function cancelTaskEdit() {
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
    document.getElementById('taskSubmitBtn').textContent = "Assign Task";
    document.getElementById('taskCancelBtn').style.display = "none";
}
document.getElementById('taskCancelBtn').addEventListener('click', cancelTaskEdit);


// --- Deletions ---
async function deleteEmployee(id) {
    if(!confirm('Delete employee?')) return;
    try {
        const res = await fetch(`${API_URL}/employees/${id}`, { method: 'DELETE' });
        if(!res.ok) throw new Error("err");
        showToast('Employee Deleted');
        fetchEmployees();
    } catch(e) { handleError() }
}
async function deleteLocation(id) {
    if(!confirm('Delete location?')) return;
    try {
        const res = await fetch(`${API_URL}/locations/${id}`, { method: 'DELETE' });
        if(!res.ok) throw new Error("err");
        showToast('Location Deleted');
        fetchLocations();
    } catch(e) { handleError() }
}

// --- Export System ---

document.getElementById('exportConveyanceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('exportFileConveyance');
    const month = document.getElementById('exportMonthConveyance').value;
    
    if(!fileInput.files[0]) return showToast("Error: No file selected");

    const formData = new FormData();
    formData.append('template', fileInput.files[0]);
    formData.append('month', month);

    try {
        showToast("Generating Conveyance Bill...");
        const res = await fetch(`${API_URL}/export/conveyance`, {
            method: 'POST',
            body: formData
        });
        
        if(!res.ok) throw new Error("Error generating file");
        
        const contentType = res.headers.get('Content-Type') || '';
        
        if (contentType.includes('application/json')) {
            // Multi-file response: download each file
            const data = await res.json();
            if (data.multiFile && data.files) {
                data.files.forEach((file, idx) => {
                    const byteChars = atob(file.data);
                    const byteNumbers = new Array(byteChars.length);
                    for (let i = 0; i < byteChars.length; i++) {
                        byteNumbers[i] = byteChars.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = file.name;
                    document.body.appendChild(a);
                    setTimeout(() => { a.click(); window.URL.revokeObjectURL(url); a.remove(); }, idx * 500);
                });
                showToast(`Export Successful! ${data.files.length} files downloaded.`);
            }
        } else {
            // Single file response
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Export_Conveyance_${month}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            showToast("Export Successful!");
        }
    } catch(e) {
        handleError();
    }
});

document.getElementById('exportFoodForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('exportFileFood');
    const month = document.getElementById('exportMonthFood').value;
    const employee_id = document.getElementById('exportEmployeeFood').value;
    
    if(!fileInput.files[0]) return showToast("Error: No file selected");

    const formData = new FormData();
    formData.append('template', fileInput.files[0]);
    formData.append('month', month);
    formData.append('employee_id', employee_id);

    try {
        showToast("Generating Food Bill...");
        const res = await fetch(`${API_URL}/export/food`, {
            method: 'POST',
            body: formData
        });
        
        if(!res.ok) throw new Error("Error generating file");
        
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Export_Food_${month}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showToast("Export Successful!");
    } catch(e) {
        handleError();
    }
});

// --- Utils ---
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    
    // highlight red if error
    if(msg.includes('Error')) {
        toast.style.background = '#ef4444';
    } else {
        toast.style.background = '#10b981';
    }

    setTimeout(() => {
        toast.classList.remove('show');
    }, 5000);
}

// --- Clients Specific Logic ---
let clientsData = [];

async function fetchClients() {
    try {
        const res = await fetch(`${API_URL}/clients`);
        if(!res.ok) return;
        clientsData = await res.json();
        renderClients();
    } catch(e) { handleError(); }
}

function renderClients() {
    const tbody = document.querySelector('#clientsTable tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    clientsData.forEach(client => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${client.client_name || ''}</td>
            <td>${client.client_type || ''}</td>
            <td>${client.location || ''}</td>
            <td><a href="tel:${client.contact || ''}">${client.contact || ''}</a></td>
            <td>
                <button class="btn btn-secondary" onclick="editClient(${client.id})" style="padding: 4px 8px; font-size:12px;">Edit</button>
                <button class="btn danger-btn" onclick="deleteClient(${client.id})" style="padding: 4px 8px; font-size:12px;">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

const clientForm = document.getElementById('clientForm');
if(clientForm) {
    clientForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('clientId').value;
        const data = {
            client_name: document.getElementById('clientName').value,
            client_type: document.getElementById('clientType').value,
            location: document.getElementById('clientLocation').value,
            aktl_assign_router: document.getElementById('clientAktlRouter').value,
            client_id: document.getElementById('clientIdentifier').value,
            bw_type: document.getElementById('clientBwType').value,
            sales_kam: document.getElementById('clientSalesKam').value,
            sales_bw: document.getElementById('clientSalesBw').value,
            total_nttn: document.getElementById('clientTotalNttn').value,
            aktl_nttn: document.getElementById('clientAktlNttn').value,
            fgl_nttn: document.getElementById('clientFglNttn').value,
            scl_nttn: document.getElementById('clientSclNttn').value,
            datomato_nttn: document.getElementById('clientDatomatoNttn').value,
            last_mile_connected: document.getElementById('clientLastMile').value,
            client_end_device: document.getElementById('clientEndDevice').value,
            nttn_link_id: document.getElementById('clientNttnLinkId').value,
            handover_date: document.getElementById('clientHandoverDate').value,
            discontinue_date: document.getElementById('clientDiscontinueDate').value,
            vlan: document.getElementById('clientVlan').value,
            asn: document.getElementById('clientAsn').value,
            ip_user_info: document.getElementById('clientIpUserInfo').value,
            lan_ip: document.getElementById('clientLanIp').value,
            mrtg: document.getElementById('clientMrtg').value,
            contact: document.getElementById('clientContact').value,
            email: document.getElementById('clientEmail').value,
            address: document.getElementById('clientAddress').value,
            router_login: document.getElementById('clientRouterLogin').value,
            remarks: document.getElementById('clientRemarks').value
        };
        const method = id ? 'PUT' : 'POST';
        const url = id ? `${API_URL}/clients/${id}` : `${API_URL}/clients`;
        
        try {
            const res = await fetch(url, {
                method, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if(res.ok) {
                clientForm.reset();
                document.getElementById('clientId').value = '';
                document.getElementById('clientCancelBtn').style.display = 'none';
                document.getElementById('clientSubmitBtn').textContent = 'Save Client';
                fetchClients();
                showToast("Client saved!");
            }
        } catch(e) { handleError(); }
    });
}

const clientCancelBtn = document.getElementById('clientCancelBtn');
if(clientCancelBtn) {
    clientCancelBtn.addEventListener('click', () => {
        clientForm.reset();
        document.getElementById('clientId').value = '';
        clientCancelBtn.style.display = 'none';
        document.getElementById('clientSubmitBtn').textContent = 'Save Client';
    });
}

window.editClient = function(id) {
    const client = clientsData.find(c => c.id === id);
    if(!client) return;
    document.getElementById('clientId').value = client.id;
    document.getElementById('clientName').value = client.client_name || '';
    document.getElementById('clientType').value = client.client_type || 'Dedicated';
    document.getElementById('clientLocation').value = client.location || '';
    document.getElementById('clientAktlRouter').value = client.aktl_assign_router || '';
    document.getElementById('clientIdentifier').value = client.client_id || '';
    document.getElementById('clientBwType').value = client.bw_type || '';
    document.getElementById('clientSalesKam').value = client.sales_kam || '';
    document.getElementById('clientSalesBw').value = client.sales_bw || '';
    document.getElementById('clientTotalNttn').value = client.total_nttn || '';
    document.getElementById('clientAktlNttn').value = client.aktl_nttn || '';
    document.getElementById('clientFglNttn').value = client.fgl_nttn || '';
    document.getElementById('clientSclNttn').value = client.scl_nttn || '';
    document.getElementById('clientDatomatoNttn').value = client.datomato_nttn || '';
    document.getElementById('clientLastMile').value = client.last_mile_connected || '';
    document.getElementById('clientEndDevice').value = client.client_end_device || '';
    document.getElementById('clientNttnLinkId').value = client.nttn_link_id || '';
    document.getElementById('clientHandoverDate').value = client.handover_date || '';
    document.getElementById('clientDiscontinueDate').value = client.discontinue_date || '';
    document.getElementById('clientVlan').value = client.vlan || '';
    document.getElementById('clientAsn').value = client.asn || '';
    document.getElementById('clientIpUserInfo').value = client.ip_user_info || '';
    document.getElementById('clientLanIp').value = client.lan_ip || '';
    document.getElementById('clientMrtg').value = client.mrtg || '';
    document.getElementById('clientContact').value = client.contact || '';
    document.getElementById('clientEmail').value = client.email || '';
    document.getElementById('clientAddress').value = client.address || '';
    document.getElementById('clientRouterLogin').value = client.router_login || '';
    document.getElementById('clientRemarks').value = client.remarks || '';
    
    document.getElementById('clientSubmitBtn').textContent = 'Update Client';
    document.getElementById('clientCancelBtn').style.display = 'inline-block';
    window.scrollTo(0, 0);
};

window.deleteClient = async function(id) {
    if(!confirm("Delete this client?")) return;
    try {
        const res = await fetch(`${API_URL}/clients/${id}`, { method: 'DELETE' });
        if(res.ok) {
            fetchClients();
            showToast("Client deleted!");
        }
    } catch(e) { handleError(); }
};

const clientUploadForm = document.getElementById('clientUploadForm');
if(clientUploadForm) {
    clientUploadForm.addEventListener('submit', async(e) => {
        e.preventDefault();
        const fileInput = document.getElementById('clientExcelFile');
        if(!fileInput.files[0]) return;
        
        let formData = new FormData();
        formData.append('excel', fileInput.files[0]);
        
        try {
            const res = await fetch(`${API_URL}/clients/upload`, {
                method: 'POST', body: formData
            });
            const data = await res.json();
            if(res.ok && data.success) {
                showToast(`Successfully imported ${data.count} clients!`);
                clientUploadForm.reset();
                fetchClients();
            } else throw new Error();
        } catch(e) { handleError(); showToast("Error connecting or parsing Excel."); }
    });
}

// Initialize
fetchEmployees();
fetchLocations();
fetchTasks();
fetchClients();

// --- INVENTORY LOGIC ---
let invProducts = [];
let invStockMap = [];

const productFieldConfig = {
    "Cable Tie": [],
    "Patch Cord": [ { id: "type", label: "Type", type: "select", opts: ["SC", "LC"] } ],
    "TJB": [ { id: "type", label: "Type", type: "select", opts: ["2F", "4F", "8F"] } ],
    "Fiber": [ { id: "type", label: "Type", type: "select", opts: ["2 Core", "4 Core"] }, { id: "Cable ID", label: "Cable ID", type: "text" } ],
    "MC": [ { id: "type", label: "Type", type: "select", opts: ["100M", "1G"] } ],
    "ONU": [ { id: "ONU_MAC", label: "ONU MAC", type: "text" } ],
    "Splitter": [ { id: "type", label: "Type", type: "select", opts: ["1x2", "1x4", "1x8", "1x16"] } ],
    "SFP": [ 
        { id: "type", label: "Speed Type", type: "select", opts: ["1G", "2G", "10G"] }, 
        { id: "NM", label: "NM", type: "number" }, 
        { id: "Length", label: "Length", type: "text" }, 
        { id: "Connector Type", label: "Connector Type", type: "select", opts: ["SC", "LC"] } 
    ]
};

async function initInventory() {
    try {
        const res = await fetch(`${API_URL}/inventory/products`);
        invProducts = await res.json();
        const recvSelect = document.getElementById('recvProduct');
        const invSelect = document.getElementById('invProduct');
        const cuetSelect = document.getElementById('cuetProduct');
        if(recvSelect) recvSelect.innerHTML = '<option value="">Select Product...</option>' + invProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        if(invSelect) invSelect.innerHTML = '<option value="">Select Product...</option>' + invProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        if(cuetSelect) cuetSelect.innerHTML = '<option value="">Select Product...</option>' + invProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        
        const listDisplay = document.getElementById('productsListDisplay');
        if(listDisplay) {
            listDisplay.innerHTML = invProducts.map(p => `<li>
                <span>${p.name}</span>
                <div>
                    <button class="btn btn-secondary" onclick="editInvProduct(${p.id})" style="padding: 4px 8px; font-size:12px; margin-right: 5px;">Edit</button>
                    <button class="btn danger-btn" onclick="deleteInvProduct(${p.id})" style="padding: 4px 8px; font-size:12px;">Delete</button>
                </div>
            </li>`).join('');
        }

        fetchDashboard();
        fetchReceives();
        fetchInvests();
        fetchCuets();
    } catch(e) {}
}

const addProductForm = document.getElementById('addProductForm');
if(addProductForm) {
    addProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('newProductId').value;
        const name = document.getElementById('newProductName').value;
        try {
            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/inventory/products/${id}` : `${API_URL}/inventory/products`;
            const res = await fetch(url, {
                method, headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name })
            });
            if(res.ok) {
                showToast(id ? "Product updated!" : "Product added!");
                cancelInvProductEdit();
                initInventory(); // refresh dropdowns and list
            } else {
                showToast("Error saving product");
            }
        } catch (e) { handleError(); }
    });
}

window.editInvProduct = function(id) {
    const p = invProducts.find(x => x.id === id);
    if(!p) return;
    document.getElementById('newProductId').value = p.id;
    document.getElementById('newProductName').value = p.name;
    document.getElementById('productSubmitBtn').textContent = "Update Product";
    document.getElementById('productCancelBtn').style.display = "inline-block";
    window.scrollTo(0, 0);
};

window.cancelInvProductEdit = function() {
    const form = document.getElementById('addProductForm');
    if(form) form.reset();
    if(document.getElementById('newProductId')) document.getElementById('newProductId').value = '';
    if(document.getElementById('productSubmitBtn')) document.getElementById('productSubmitBtn').textContent = "Save Product";
    if(document.getElementById('productCancelBtn')) document.getElementById('productCancelBtn').style.display = "none";
};

const productCancelBtn = document.getElementById('productCancelBtn');
if(productCancelBtn) productCancelBtn.addEventListener('click', cancelInvProductEdit);

window.deleteInvProduct = async function(id) {
    if(!confirm("Delete this product category? (Warning: This may break existing tracking logs if the product is in use)")) return;
    try {
        const res = await fetch(`${API_URL}/inventory/products/${id}`, { method: 'DELETE' });
        if(res.ok) {
            showToast("Product deleted!");
            initInventory();
        }
    } catch(e) { handleError(); }
};
window.handleProductFormChange = function(prefix) {
    const sel = document.getElementById(`${prefix}Product`);
    const pId = sel.value;
    const pName = pId ? sel.options[sel.selectedIndex].text : '';
    const container = document.getElementById(`${prefix}DynamicFields`);
    
    if(!pName || !productFieldConfig[pName] || productFieldConfig[pName].length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
    } else {
        container.style.display = 'grid';
        let html = '';
        productFieldConfig[pName].forEach(f => {
            if(f.type === 'select') {
                html += `<div class="form-group"><label>${f.label}</label><select id="${prefix}_dyn_${f.id}" required>${f.opts.map(o => `<option value="${o}">${o}</option>`).join('')}</select></div>`;
            } else {
                html += `<div class="form-group"><label>${f.label}</label><input type="${f.type}" id="${prefix}_dyn_${f.id}" required></div>`;
            }
        });
        // Add scanner trigger button for ONU product
        if(pName === 'ONU') {
            html += `<div class="form-group grid-full" style="margin-top:5px;">
                <button type="button" class="scanner-trigger-btn" onclick="openScannerOverlay('${prefix}')">
                    📷 Scan ONU MAC (Camera)
                </button>
                <div id="${prefix}_scannedPreview" style="margin-top:10px;"></div>
            </div>`;
        }
        container.innerHTML = html;
    }
    
    // Check stock warning for invest and cuet
    if(prefix === 'inv' || prefix === 'cuet') checkStockWarning(prefix);
}

function getFormDynData(prefix, pName) {
    let variant = '';
    let extra = {};
    if(productFieldConfig[pName]) {
        productFieldConfig[pName].forEach(f => {
            const val = document.getElementById(`${prefix}_dyn_${f.id}`).value;
            if(f.id === 'type') variant = val;
            else extra[f.id] = val;
        });
    }
    return { variant: variant || 'Standard', extra };
}

let movementChartInstance = null;
let stockPieChartInstance = null;

async function fetchDashboard() {
    try {
        const monthFilter = document.getElementById('dashboardMonthFilter') ? document.getElementById('dashboardMonthFilter').value : '';
        const res = await fetch(`${API_URL}/inventory/dashboard${monthFilter ? '?month='+monthFilter : ''}`);
        if(!res.ok) return;
        const data = await res.json();
        invStockMap = data.stockMap || [];
        
        const tbody = document.querySelector('#lowStockTable tbody');
        if(tbody) {
            tbody.innerHTML = '';
            (data.lowStockItems || []).forEach(item => {
                tbody.innerHTML += `<tr><td>${item.product_name}</td><td>${item.variant}</td><td style="color:var(--danger);font-weight:bold;">${item.stock}</td></tr>`;
            });
        }
        
        updateCharts(data.stockMap || []);
        renderMatrixTable(data.stockMap || []);
    } catch(e) {}
}

function renderMatrixTable(stockMap) {
    const tbody = document.querySelector('#inventoryMatrixTable tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    stockMap.forEach(s => {
        tbody.innerHTML += `<tr>
            <td>${s.product_name}</td>
            <td>${s.variant}</td>
            <td>${s.received}</td>
            <td>${s.chittagong_stock || 0}</td>
            <td>${s.cuet_stock || 0}</td>
            <td><strong>${s.stock}</strong></td>
        </tr>`;
    });
}

function updateCharts(stockMap) {
    const ctxMovement = document.getElementById('movementChart');
    const ctxStock = document.getElementById('stockPieChart');
    if(!ctxMovement || !ctxStock) return;

    const labels = stockMap.map(s => `${s.product_name} (${s.variant})`);
    const receivedData = stockMap.map(s => s.received);
    const investedData = stockMap.map(s => s.invested);
    const currentStockData = stockMap.map(s => s.stock);

    if (movementChartInstance) movementChartInstance.destroy();
    movementChartInstance = new Chart(ctxMovement, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Received',
                    data: receivedData,
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: 'rgb(16, 185, 129)',
                    borderWidth: 1
                },
                {
                    label: 'Invested',
                    data: investedData,
                    backgroundColor: 'rgba(245, 158, 11, 0.7)',
                    borderColor: 'rgb(245, 158, 11)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } }
        }
    });

    if (stockPieChartInstance) stockPieChartInstance.destroy();
    stockPieChartInstance = new Chart(ctxStock, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: currentStockData,
                backgroundColor: [
                    '#6c5ce7', '#a29bfe', '#00cec9', '#81ecec',
                    '#00b894', '#55efc4', '#e17055', '#fab1a0',
                    '#d63031', '#ff7675', '#e84393', '#fd79a8'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } }
            }
        }
    });
}

async function fetchReceives() {
    try {
        const res = await fetch(`${API_URL}/inventory/receive`);
        if(!res.ok) return;
        const data = await res.json();
        const tbody = document.querySelector('#receivesTable tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        data.slice(0,25).forEach(r => {
            const exc = Object.keys(JSON.parse(r.extra_fields||'{}')).map(k => `${k}:${JSON.parse(r.extra_fields)[k]}`).join(', ');
            tbody.innerHTML += `<tr>
                <td>${r.date}</td>
                <td>${r.product_name}</td>
                <td>${r.variant} ${exc?`(${exc})`:''}</td>
                <td>${r.quantity}</td>
                <td><button class="btn danger-btn" onclick="delReceive(${r.id})">Delete</button></td>
            </tr>`;
        });
    } catch(e){}
}

async function fetchInvests() {
    try {
        const res = await fetch(`${API_URL}/inventory/invest`);
        if(!res.ok) return;
        const data = await res.json();
        const tbody = document.querySelector('#investsTable tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        data.slice(0,25).forEach(r => {
            const exc = Object.keys(JSON.parse(r.extra_fields||'{}')).map(k => `${k}:${JSON.parse(r.extra_fields)[k]}`).join(', ');
            tbody.innerHTML += `<tr>
                <td>${r.date}</td>
                <td>${r.product_name}</td>
                <td>${r.variant} ${exc?`(${exc})`:''}</td>
                <td>${r.quantity}</td>
                <td>${r.office}</td>
                <td><button class="btn danger-btn" onclick="delInvest(${r.id})">Delete</button></td>
            </tr>`;
        });
    } catch(e){}
}

window.delReceive = function(id) {
    if(!confirm("Delete this receive record?")) return;
    fetch(`${API_URL}/inventory/receive/${id}`, { method: 'DELETE' }).then(() => { fetchReceives(); fetchDashboard(); loadReportData(); });
}
window.delInvest = function(id) {
    if(!confirm("Delete this invest record?")) return;
    fetch(`${API_URL}/inventory/invest/${id}`, { method: 'DELETE' }).then(() => { fetchInvests(); fetchDashboard(); loadReportData(); });
}
window.delCuet = function(id) {
    if(!confirm("Delete this CUET transfer record?")) return;
    fetch(`${API_URL}/inventory/sent-cuet/${id}`, { method: 'DELETE' }).then(() => { fetchCuets(); fetchDashboard(); loadReportData(); });
}

async function fetchCuets() {
    try {
        const res = await fetch(`${API_URL}/inventory/sent-cuet`);
        if(!res.ok) return;
        const data = await res.json();
        const tbody = document.querySelector('#cuetsTable tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        data.slice(0,25).forEach(r => {
            const exc = Object.keys(JSON.parse(r.extra_fields||'{}')).map(k => `${k}:${JSON.parse(r.extra_fields)[k]}`).join(', ');
            tbody.innerHTML += `<tr>
                <td>${r.date}</td>
                <td>${r.product_name}</td>
                <td>${r.quantity} ${r.variant} ${exc?`(${exc})`:''}</td>
                <td>${r.notes}</td>
                <td><button class="btn danger-btn" onclick="delCuet(${r.id})">Delete</button></td>
            </tr>`;
        });
    } catch(e){}
}

const recvForm = document.getElementById('receiveForm');
if(recvForm) {
    recvForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pId = document.getElementById('recvProduct').value;
        const pName = document.getElementById('recvProduct').options[document.getElementById('recvProduct').selectedIndex].text;
        const qty = document.getElementById('recvQty').value;
        const cost = document.getElementById('recvCost').value || 0;
        const date = document.getElementById('recvDate').value;
        const notes = document.getElementById('recvNotes').value;
        const dyn = getFormDynData('recv', pName);
        
        await fetch(`${API_URL}/inventory/receive`, {
            method: 'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ product_id: pId, variant: dyn.variant, quantity: qty, source_office:'Dhaka', notes, extra_fields: dyn.extra, date, total_cost: cost })
        });
        showToast("Product received!");
        recvForm.reset();
        handleProductFormChange('recv');
        fetchReceives();
        fetchDashboard();
        loadReportData();
    });
}

const investForm = document.getElementById('investForm');
if(investForm) {
    investForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pId = document.getElementById('invProduct').value;
        const pName = document.getElementById('invProduct').options[document.getElementById('invProduct').selectedIndex].text;
        const qty = parseInt(document.getElementById('invQty').value);
        const cost = document.getElementById('invCost').value || 0;
        const date = document.getElementById('invDate').value;
        const office = document.getElementById('invOffice').value;
        const notes = document.getElementById('invNotes').value;
        const dyn = getFormDynData('inv', pName);
        
        // Stock Check
        const key = `${pId}_${dyn.variant}`;
        const stockItem = invStockMap.find(s => s.product_id == pId && s.variant == dyn.variant);
        const avail = stockItem ? stockItem.stock : 0;
        
        if(qty > avail) {
            showToast(`Error: Insufficient stock. Available: ${avail}`);
            return;
        }

        await fetch(`${API_URL}/inventory/invest`, {
            method: 'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ product_id: pId, variant: dyn.variant, quantity: qty, office, notes, extra_fields: dyn.extra, date, total_cost: cost })
        });
        showToast("Product invested!");
        investForm.reset();
        handleProductFormChange('inv');
        fetchInvests();
        fetchDashboard();
        loadReportData();
    });
    
    // Bind qty change dynamically
    document.getElementById('invQty').addEventListener('input', () => checkStockWarning('inv'));
}

const cuetForm = document.getElementById('cuetForm');
if(cuetForm) {
    cuetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pId = document.getElementById('cuetProduct').value;
        const pName = document.getElementById('cuetProduct').options[document.getElementById('cuetProduct').selectedIndex].text;
        const qty = parseInt(document.getElementById('cuetQty').value);
        const date = document.getElementById('cuetDate').value;
        const notes = document.getElementById('cuetNotes').value;
        const dyn = getFormDynData('cuet', pName);
        
        // Stock Check
        const stockItem = invStockMap.find(s => s.product_id == pId && s.variant == dyn.variant);
        const avail = stockItem ? stockItem.stock : 0;
        
        if(qty > avail) {
            showToast(`Error: Insufficient stock. Available: ${avail}`);
            return;
        }

        await fetch(`${API_URL}/inventory/sent-cuet`, {
            method: 'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ product_id: pId, variant: dyn.variant, quantity: qty, notes, extra_fields: dyn.extra, date })
        });
        showToast("Product sent to CUET!");
        cuetForm.reset();
        handleProductFormChange('cuet');
        fetchCuets();
        fetchDashboard();
        loadReportData();
    });
    
    // Bind qty change dynamically
    document.getElementById('cuetQty').addEventListener('input', () => checkStockWarning('cuet'));
}

function checkStockWarning(prefix = 'inv') {
    const pId = document.getElementById(`${prefix}Product`).value;
    const sel = document.getElementById(`${prefix}Product`);
    const pName = pId ? sel.options[sel.selectedIndex].text : '';
    const w = document.getElementById('stockWarning');
    if(!pId) { w.style.display = 'none'; return; }
    
    // Get current dyn
    let dynVariant = '';
    if(productFieldConfig[pName]) {
        const typeEl = document.getElementById(`${prefix}_dyn_type`);
        if(typeEl) dynVariant = typeEl.value;
    }
    const variant = dynVariant || 'Standard';
    const stockItem = invStockMap.find(s => s.product_id == pId && s.variant == variant);
    const avail = stockItem ? stockItem.stock : 0;
    
    const reqQty = parseInt(document.getElementById(`${prefix}Qty`).value) || 0;
    if(reqQty > avail) {
        w.style.display = 'block';
        w.textContent = `Warning: Insufficient stock! Only ${avail} available for ${pName} (${variant}).`;
    } else {
        w.style.display = 'none';
    }
}
if(document.getElementById('invDynamicFields')) {
    document.getElementById('invDynamicFields').addEventListener('change', () => checkStockWarning('inv'));
}
if(document.getElementById('cuetDynamicFields')) {
    document.getElementById('cuetDynamicFields').addEventListener('change', () => checkStockWarning('cuet'));
}

window.loadReportData = async function() {
    const month = document.getElementById('reportMonthFilter') ? document.getElementById('reportMonthFilter').value : '';
    const res = await fetch(`${API_URL}/inventory/dashboard?month=${month}`);
    if(res.ok) {
        const data = await res.json();
        const tbody = document.querySelector('#reportTable tbody');
        if(tbody) {
            tbody.innerHTML = '';
            // But dashboard stock map returns current overall stock.
            // Wait, we need actual monthly aggregated report.
            // Let's call a quick map locally using the Dashboard monthly filtering.
            // Oh right, dashboard API handles monthly filters for the `stockMap`.
            (data.stockMap||[]).forEach(r => {
                if(r.received > 0 || r.invested > 0) {
                     tbody.innerHTML += `<tr>
                         <td>${r.product_name}</td>
                         <td>${r.variant}</td>
                         <td>${r.received}</td>
                         <td>-</td>
                         <td>-</td>
                         <td>${r.stock}</td>
                     </tr>`;
                }
            });
            // Let's improve the table by doing a specific fetch or just let it compile here correctly since server dashboard groups them.
            // Actually, the server dashboard doesn't split invested by location. The export route does.
            // It's okay, for this UI view, we can just show total invested, or fetch from the raw invests arrays which weren't passed.
            // Let's fetch the /api/inventory/dashboard but we can leave the table as simple for now and if we need the detailed CTG / CUET split,
            // we should probably let the user use Export Excel since it was implemented in the API. Wait, I will just call the APIs manually to aggregate.
        }
    }
    
    // manual fetch for report ui
    try {
        const rRes = await fetch(`${API_URL}/inventory/receive`);
        const iRes = await fetch(`${API_URL}/inventory/invest`);
        const receivesList = await rRes.json();
        const investsList = await iRes.json();
        
        const rep = {};
        const mStr = month; // "2026-04"
        receivesList.forEach(r => {
            if(mStr && !r.date.startsWith(mStr)) return;
            const k = `${r.product_name}_${r.variant}`;
            if(!rep[k]) rep[k] = { name: r.product_name, variant: r.variant, recv: 0, inv_ctg: 0, inv_cuet: 0, total_stock: 0 };
            rep[k].recv += r.quantity;
        });
        investsList.forEach(i => {
            if(mStr && !i.date.startsWith(mStr)) return;
            const k = `${i.product_name}_${i.variant}`;
            if(!rep[k]) rep[k] = { name: i.product_name, variant: i.variant, recv: 0, inv_ctg: 0, inv_cuet: 0, total_stock: 0 };
            if(i.office === 'CTG') rep[k].inv_ctg += i.quantity;
            else if(i.office === 'CUET') rep[k].inv_cuet += i.quantity;
        });
        
        // Also compute total overall stock for the remaining column from invStockMap
        Object.keys(rep).forEach(k => {
             const stockInfo = invStockMap.find(s => s.product_name === rep[k].name && s.variant === rep[k].variant);
             rep[k].total_stock = stockInfo ? stockInfo.stock : rep[k].recv - (rep[k].inv_ctg + rep[k].inv_cuet);
        });

        const tbody = document.querySelector('#reportTable tbody');
        if(tbody) {
            tbody.innerHTML = '';
            Object.values(rep).forEach(r => {
                tbody.innerHTML += `<tr>
                     <td>${r.name}</td>
                     <td>${r.variant}</td>
                     <td>${r.recv}</td>
                     <td>${r.inv_ctg}</td>
                     <td>${r.inv_cuet}</td>
                     <td>${r.total_stock}</td>
                 </tr>`;
            });
        }
    } catch(e){}
}

window.printReport = function() {
    document.getElementById('printRepTitle').textContent = `Inventory Report - ${document.getElementById('reportMonthFilter').value || 'All Time'}`;
    window.print();
}

window.exportExcelReport = async function() {
    const month = document.getElementById('reportMonthFilter').value;
    try {
        const formData = new FormData();
        formData.append('month', month);
        // Add a dummy file because upload.single('template') expects it based on existing multer logic in server.js
        const dummyBlob = new Blob([""], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        formData.append('template', dummyBlob, "dummy.xlsx");

        showToast("Generating Report...");
        const res = await fetch(`${API_URL}/export/inventory_report`, {
            method: 'POST',
            body: formData
        });
        
        if(!res.ok) throw new Error("Error generating file");
        
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Inventory_Report_${month||'All'}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showToast("Export Successful!");
    } catch(e) {
        handleError();
    }
}

initInventory();

// --- User Management Logic ---
let usersData = [];

async function fetchUsers() {
    if (userRole !== 'admin') return;
    try {
        const res = await fetch(`${API_URL}/auth/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to fetch users");
        usersData = await res.json();
        renderUsers();
    } catch(e) {}
}

function renderUsers() {
    const tbody = document.querySelector('#usersTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    usersData.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${user.username}</td>
            <td>${user.user_id}</td>
            <td>${user.role}</td>
            <td>
                <button class="btn btn-secondary" onclick="editUser(${user.id})" style="padding: 4px 8px; font-size:12px; margin-right: 5px;">Edit</button>
                <button class="btn danger-btn" onclick="deleteUser(${user.id})" style="padding: 4px 8px; font-size:12px;">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

const userForm = document.getElementById('userForm');
if (userForm) {
    userForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('manageUserId').value;
        const username = document.getElementById('manageUserName').value;
        const user_id = document.getElementById('manageUserIdField').value;
        const password = document.getElementById('manageUserPassword').value;
        
        const checkboxes = document.querySelectorAll('#permissionsCheckboxes input[type="checkbox"]');
        const permissions = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

        const method = id ? 'PUT' : 'POST';
        const url = id ? `${API_URL}/auth/users/${id}` : `${API_URL}/auth/users`;
        
        const payload = { username, user_id, permissions, role: 'user' };
        if (password) payload.password = password;

        try {
            const res = await fetch(url, {
                method,
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                showToast(id ? 'User Updated Successfully' : 'User Added Successfully');
                cancelUserEdit();
                fetchUsers();
            } else {
                const data = await res.json();
                showToast(`Error: ${data.error || 'Failed to save user'}`);
            }
        } catch(e) { handleError(); }
    });
}

window.editUser = function(id) {
    const user = usersData.find(u => u.id === id);
    if (!user) return;
    
    document.getElementById('manageUserId').value = user.id;
    document.getElementById('manageUserName').value = user.username;
    document.getElementById('manageUserIdField').value = user.user_id;
    document.getElementById('manageUserPassword').value = '';
    
    document.querySelectorAll('#permissionsCheckboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
    
    let perms = [];
    try { perms = JSON.parse(user.permissions || '[]'); } catch(e) {}
    perms.forEach(p => {
        const cb = document.querySelector(`#permissionsCheckboxes input[value="${p}"]`);
        if (cb) cb.checked = true;
    });

    document.getElementById('userSubmitBtn').textContent = "Update User";
    document.getElementById('userCancelBtn').style.display = "inline-block";
    window.scrollTo(0, 0);
};

window.cancelUserEdit = function() {
    if (userForm) userForm.reset();
    document.getElementById('manageUserId').value = '';
    document.querySelectorAll('#permissionsCheckboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
    if (document.getElementById('userSubmitBtn')) document.getElementById('userSubmitBtn').textContent = "Save User";
    if (document.getElementById('userCancelBtn')) document.getElementById('userCancelBtn').style.display = "none";
};

if (document.getElementById('userCancelBtn')) {
    document.getElementById('userCancelBtn').addEventListener('click', cancelUserEdit);
}

window.deleteUser = async function(id) {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
        const res = await fetch(`${API_URL}/auth/users/${id}`, { 
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            fetchUsers();
            showToast("User deleted!");
        } else {
            const data = await res.json();
            showToast(`Error: ${data.error || 'Failed to delete user'}`);
        }
    } catch(e) { handleError(); }
};

if (userRole === 'admin') fetchUsers();

// ============================
// --- ONU MAC SCANNER ENGINE ---
// ============================
let scannerInstance = null;
let scannedMacs = [];
let activeScannerPrefix = null; // 'recv' or 'inv'
let lastScanTime = 0;

// MAC address validation: 12 hex chars (with or without separators)
function extractMAC(rawText) {
    if (!rawText) return null;
    // Remove whitespace
    let cleaned = rawText.trim();
    
    // Try to find MAC pattern in the text (handles QR codes with extra data)
    // Pattern: 12 hex chars possibly separated by : or - or .
    const macPatterns = [
        /(?:MAC[:\s]*)?([0-9A-Fa-f]{2}[:\-\.][0-9A-Fa-f]{2}[:\-\.][0-9A-Fa-f]{2}[:\-\.][0-9A-Fa-f]{2}[:\-\.][0-9A-Fa-f]{2}[:\-\.][0-9A-Fa-f]{2})/i,
        /(?:MAC[:\s]*)?([0-9A-Fa-f]{12})/i,
        /(?:MAC[:\s]*)?([0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4})/i
    ];
    
    for (const pattern of macPatterns) {
        const match = cleaned.match(pattern);
        if (match) {
            // Normalize: remove separators and uppercase
            return match[1].replace(/[:\-\.]/g, '').toUpperCase();
        }
    }
    return null;
}

function formatMAC(raw) {
    // Format as XX:XX:XX:XX:XX:XX
    if (!raw || raw.length !== 12) return raw;
    return raw.match(/.{2}/g).join(':');
}

function flashScanner(type) {
    const flash = document.getElementById('scannerFlash');
    if (!flash) return;
    flash.className = 'scanner-flash ' + type;
    setTimeout(() => { flash.className = 'scanner-flash'; }, 300);
}

function updateScannerUI() {
    const countEl = document.getElementById('scannerCount');
    const listEl = document.getElementById('scannerMacList');
    if (countEl) countEl.textContent = scannedMacs.length;
    if (listEl) {
        listEl.innerHTML = scannedMacs.map((mac, i) => `
            <tr>
                <td>${i + 1}</td>
                <td style="font-family:monospace;font-weight:600;letter-spacing:1px;">${formatMAC(mac)}</td>
                <td><button class="mac-remove-btn" onclick="removeScannedMac(${i})">✕</button></td>
            </tr>
        `).join('');
        // Auto-scroll to bottom
        const wrapper = listEl.closest('.scanner-list-wrapper');
        if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
    }
}

window.removeScannedMac = function(index) {
    scannedMacs.splice(index, 1);
    updateScannerUI();
};

window.clearScannedMacs = function() {
    scannedMacs = [];
    updateScannerUI();
};

window.openScannerOverlay = function(prefix) {
    activeScannerPrefix = prefix;
    scannedMacs = [];
    updateScannerUI();
    
    const overlay = document.getElementById('scannerOverlay');
    overlay.style.display = 'flex';
    
    const statusEl = document.getElementById('scannerStatus');
    statusEl.textContent = 'Initializing camera...';
    statusEl.className = 'scanner-status';
    
    // Initialize html5-qrcode scanner
    setTimeout(() => {
        startCameraScanner();
    }, 300);
};

window.closeScannerOverlay = function() {
    stopCameraScanner();
    document.getElementById('scannerOverlay').style.display = 'none';
};

async function startCameraScanner() {
    const camViewId = 'scannerCamView';
    const statusEl = document.getElementById('scannerStatus');
    
    try {
        if (scannerInstance) {
            try { await scannerInstance.stop(); } catch(e) {}
            scannerInstance.clear();
            scannerInstance = null;
        }
        
        scannerInstance = new Html5Qrcode(camViewId);
        
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || cameras.length === 0) {
            statusEl.textContent = '❌ No camera found. Please grant camera permission.';
            return;
        }
        
        // Prefer back camera for mobile scanning
        let cameraId = cameras[0].id;
        const backCam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear') || c.label.toLowerCase().includes('environment'));
        if (backCam) cameraId = backCam.id;
        
        await scannerInstance.start(
            cameraId,
            {
                fps: 15,
                qrbox: { width: 280, height: 280 },
                aspectRatio: 1.0,
                disableFlip: false
            },
            onScanSuccess,
            onScanFailure
        );
        
        statusEl.textContent = '🟢 Camera active — Point at ONU QR code or barcode';
        statusEl.className = 'scanner-status active';
        
    } catch(err) {
        console.error('Scanner init error:', err);
        statusEl.textContent = '❌ Camera error: ' + (err.message || err);
        statusEl.className = 'scanner-status';
    }
}

function onScanSuccess(decodedText, decodedResult) {
    // Throttle: ignore scans within 800ms of each other
    const now = Date.now();
    if (now - lastScanTime < 800) return;
    lastScanTime = now;
    
    const mac = extractMAC(decodedText);
    
    if (!mac || mac.length !== 12) {
        // Invalid MAC
        flashScanner('error');
        const statusEl = document.getElementById('scannerStatus');
        statusEl.textContent = `❌ Invalid data: "${decodedText.substring(0, 40)}" — Not a valid MAC`;
        statusEl.className = 'scanner-status';
        setTimeout(() => {
            statusEl.textContent = '🟢 Camera active — Point at ONU QR code or barcode';
            statusEl.className = 'scanner-status active';
        }, 2000);
        return;
    }
    
    // Check duplicate
    if (scannedMacs.includes(mac)) {
        flashScanner('error');
        const statusEl = document.getElementById('scannerStatus');
        statusEl.textContent = `⚠️ Duplicate MAC: ${formatMAC(mac)} — Already scanned`;
        statusEl.className = 'scanner-status';
        setTimeout(() => {
            statusEl.textContent = '🟢 Camera active — Point at ONU QR code or barcode';
            statusEl.className = 'scanner-status active';
        }, 2000);
        // Play a small beep-like feedback via vibration if available
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        return;
    }
    
    // Success! Add the MAC
    scannedMacs.push(mac);
    flashScanner('success');
    updateScannerUI();
    
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(100);
    
    const statusEl = document.getElementById('scannerStatus');
    statusEl.textContent = `✅ Captured: ${formatMAC(mac)} — Total: ${scannedMacs.length}`;
    statusEl.className = 'scanner-status active';
}

function onScanFailure(error) {
    // Silent — continuous scanning, failures are normal between frames
}

async function stopCameraScanner() {
    if (scannerInstance) {
        try {
            await scannerInstance.stop();
            scannerInstance.clear();
        } catch(e) {}
        scannerInstance = null;
    }
}

window.finishScanning = function() {
    if (scannedMacs.length === 0) {
        showToast('No MACs scanned yet!');
        return;
    }
    
    const prefix = activeScannerPrefix;
    if (!prefix) return;
    
    // Populate the ONU MAC field with all scanned MACs joined
    const macField = document.getElementById(`${prefix}_dyn_ONU_MAC`);
    if (macField) {
        macField.value = scannedMacs.map(m => formatMAC(m)).join(', ');
    }
    
    // Auto-set the quantity field
    const qtyField = document.getElementById(`${prefix}Qty`);
    if (qtyField) {
        qtyField.value = scannedMacs.length;
    }
    
    // Show preview under the scanner button in the form
    const previewEl = document.getElementById(`${prefix}_scannedPreview`);
    if (previewEl) {
        previewEl.innerHTML = `<div style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:10px; font-size:13px; color:#10b981;">
            ✅ <strong>${scannedMacs.length}</strong> ONU MAC(s) captured and applied to form.
            <div style="margin-top:6px; font-family:monospace; font-size:11px; color:#94a3b8; max-height:80px; overflow-y:auto;">
                ${scannedMacs.map(m => formatMAC(m)).join('<br>')}
            </div>
        </div>`;
    }
    
    // Close overlay
    closeScannerOverlay();
    showToast(`${scannedMacs.length} ONU MAC(s) applied!`);
};
