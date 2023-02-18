/**
 * @author Jacob Chisholm
 * 
 */

function windowResize(){
    const platform = navigator.userAgent;
    let deviceType = "desktop";

    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(platform)) {
        deviceType = "tablet";
    }
    else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(platform)) {
        deviceType = "mobile";
    }

    const sidebar = document.getElementById("sidebar");
    const content = document.getElementById("page-content");
    const contactHeader = document.getElementById("contact-header");
    const header = document.getElementById("sidebar-header");
    const footer = document.getElementById("sidebar-footer");
    const authAbout = document.getElementById("auth-about");
    //const article = document.getElementsByName("article");

    if(window.innerWidth < 900 || deviceType === "mobile"){
        contactHeader.style.visibility = 'hidden';
        authAbout.style.textAlign = 'center';

        sidebar.style.position = 'static';
        sidebar.style.justifyContent = 'space-between';
        sidebar.style.width = '100%';
        //sidebar.style.minWidth = '600px';
        sidebar.style.height = '';//'calc(285px - 6vw)';
        sidebar.style.flexDirection = 'column';

        content.style.marginLeft = '5px';
    }
    else{
        contactHeader.style.visibility = 'visible';

        sidebar.style.position = 'fixed';
        sidebar.style.justifyContent = 'space-between';
        sidebar.style.width = '240px';
        sidebar.style.minWidth = '0px';
        sidebar.style.height = '100%';
        sidebar.style.flexDirection = 'column';

        content.style.marginLeft = '245px';
    }
}

window.onload = () => {
    windowResize();
}

window.addEventListener("resize", windowResize, true)